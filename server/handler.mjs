/* =========================================================
   Ordering API — every /api/* request comes through here.
   Written against the standard Request/Response objects, so the same code
   runs in the local dev server (server/dev.mjs) and on Netlify
   (netlify/functions/api.mjs).
   ========================================================= */
import data from "../js/data.js";
import { indexMenu, orderTimes, isValidTime, quote } from "../ordering/shared.mjs";
import { getStore } from "./store.mjs";
import { createCheckoutSession, verifyWebhook } from "./stripe.mjs";
import { notifyNewOrder, notifyRequest } from "./notify.mjs";

const { MENU, HOURS, ORDERING } = data;
const menuIndex = indexMenu(MENU);
const STATUSES = ["new", "preparing", "ready", "completed", "cancelled"];

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

// "stripe" when a Stripe key is set, "demo" (simulated payment page) only when
// DEMO_PAYMENTS=true, otherwise card payments are switched off.
const cardMode = (env) => env.STRIPE_SECRET_KEY ? "stripe" : env.DEMO_PAYMENTS === "true" ? "demo" : "off";

export async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/api\//, "/").replace(/\/+$/, "");
  const ctx = { req, env, url, store: getStore(env) };
  try {
    switch (`${req.method} ${path}`) {
      case "GET /config": return await getConfig(ctx);
      case "POST /checkout": return await checkout(ctx);
      case "GET /order": return await orderStatus(ctx);
      case "POST /stripe-webhook": return await stripeWebhook(ctx);
      case "POST /demo-pay": return await demoPay(ctx);
      case "POST /table-request": return await tableRequest(ctx);
      case "POST /admin/login": return await adminLogin(ctx);
      case "GET /admin/orders": await requireAdmin(ctx); return await adminOrders(ctx);
      case "POST /admin/status": await requireAdmin(ctx); return await adminStatus(ctx);
      case "POST /admin/availability": await requireAdmin(ctx); return await adminAvailability(ctx);
      case "POST /admin/request-done": await requireAdmin(ctx); return await adminRequestDone(ctx);
      case "GET /admin/tables": await requireAdmin(ctx); return await adminTables(ctx);
      default: throw new HttpError(404, "not_found");
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status);
    console.error("[ordering]", err);
    return json({ error: "server" }, 500);
  }
}

async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "bad_json"); }
}
const str = (v, max) => String(v ?? "").trim().slice(0, max);

/* ---------- Customer side ---------- */

async function getConfig({ env, store }) {
  const avail = await store.getSettings();
  const mode = cardMode(env);
  return json({
    card: mode !== "off",
    demo: mode === "demo",
    payLater: !!ORDERING.payLater,
    table: !!(ORDERING.table && ORDERING.table.enabled && tableSecret(env)),
    paused: avail.paused,
    soldOut: avail.soldOut,
  });
}

/* ---------- Table (QR code) ordering ----------
   Each table's QR code carries a short key signed with a secret, so an order or a
   "call a waiter" request can only come from someone who scanned that table's code. */

// TABLE_SECRET keeps printed QR codes valid even if the staff password changes
const tableSecret = (env) => env.TABLE_SECRET || (env.ADMIN_PASSWORD ? `${env.ADMIN_PASSWORD}:tables` : "");
const tableKey = async (env, n) => (await hmac(tableSecret(env), `table:${n}`)).slice(0, 16);

async function checkTable(env, table, key) {
  const n = Number(table);
  if (!ORDERING.table?.enabled || !tableSecret(env)) throw new HttpError(400, "table_off");
  if (!Number.isInteger(n) || n < 1 || n > ORDERING.table.tables) throw new HttpError(400, "table");
  if (env.DEMO_PAYMENTS === "true" && !key) return n; // demo only: the "Try it as Table 5" link has no key
  if (!(await sameText(String(key ?? ""), await tableKey(env, n)))) throw new HttpError(400, "table");
  return n;
}

async function tableRequest({ req, env, store }) {
  const b = await body(req);
  const table = await checkTable(env, b.table, b.key);
  const kind = b.kind === "bill" ? "bill" : "waiter";
  // pressing the button twice doesn't send a second alert while the first is still open
  const open = await store.listRequests();
  if (!open.some((r) => r.table === table && r.kind === kind)) {
    const request = await store.createRequest({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), table, kind });
    await notifyRequest(request, env);
  }
  return json({ ok: true });
}

async function checkout({ req, env, url, store }) {
  const b = await body(req);
  const avail = await store.getSettings();
  if (avail.paused) throw new HttpError(409, "paused");

  const type = ["delivery", "table"].includes(b.type) ? b.type : "pickup";
  const table = type === "table" ? await checkTable(env, b.table, b.tableKey) : null;
  const cart = Array.isArray(b.items) ? b.items.slice(0, 60).map((l) => ({ id: str(l.id, 60), qty: Number(l.qty) })) : [];
  const address = type === "delivery"
    ? { street: str(b.address?.street, 120), postcode: str(b.address?.postcode, 10), notes: str(b.address?.notes, 200) }
    : null;
  const q = quote(cart, { menuIndex, settings: ORDERING, type, postcode: address ? address.postcode : null, soldOut: avail.soldOut });
  if (q.errors.length) throw new HttpError(400, q.errors[0]);
  if (address && address.street.length < 3) throw new HttpError(400, "street");

  // table orders are for right now, while the kitchen is open; the others pick a time
  const times = orderTimes(HOURS, ORDERING, type === "table" ? "pickup" : type);
  const when = type === "table" ? "asap" : str(b.when, 20);
  if (type === "table" && !times.openNow) throw new HttpError(409, "closed");
  if (!isValidTime(when, times)) throw new HttpError(400, "slot");

  // guests at a table don't need to leave a name or phone number
  const customer = { name: str(b.customer?.name, 80), phone: str(b.customer?.phone, 30), email: str(b.customer?.email, 120) };
  if (type !== "table" && customer.name.length < 2) throw new HttpError(400, "name");
  if ((type !== "table" || customer.phone) && !/^[+0-9 ()-]{8,}$/.test(customer.phone)) throw new HttpError(400, "phone");
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new HttpError(400, "email");

  const mode = cardMode(env);
  const payment = b.payment === "later" ? "later" : "card";
  if (payment === "card" && mode === "off") throw new HttpError(400, "payment");
  if (payment === "later" && !ORDERING.payLater) throw new HttpError(400, "payment");

  const order = await store.create({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: payment === "card" ? "pending_payment" : "new",
    paid: false,
    payment,
    demo: payment === "card" && mode === "demo",
    type,
    table,
    when,
    customer,
    address,
    items: q.lines.map(({ id, qty, name, unit, total }) => ({ id, qty, name, unit, total })),
    subtotal: q.subtotal,
    deliveryFee: q.deliveryFee,
    total: q.total,
    notes: str(b.notes, 500),
    lang: b.lang === "el" ? "el" : "en",
  });

  // where the customer comes back to: the page they ordered from (same site only)
  let page = `${url.origin}/`;
  try { const r = new URL(b.returnUrl); if (r.origin === url.origin) page = r.origin + r.pathname; } catch { /* keep default */ }
  const statusUrl = `${page}?order=${order.id}`;

  if (payment === "later") {
    await notifyNewOrder(order, env);
    return json({ url: statusUrl });
  }
  if (mode === "demo") {
    return json({ url: new URL(`ordering/demo-pay.html?order=${order.id}`, page).href });
  }
  const session = await createCheckoutSession(env, {
    order, currency: ORDERING.currency, successUrl: statusUrl, cancelUrl: `${page}?checkout=cancelled#menu`,
  });
  await store.update(order.id, { stripeSession: session.id });
  return json({ url: session.url });
}

// what the customer's confirmation screen shows (no phone, address or email)
async function orderStatus({ url, store }) {
  const id = url.searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "id");
  const o = await store.get(id);
  if (!o) throw new HttpError(404, "not_found");
  return json({
    number: o.number, status: o.status, type: o.type, table: o.table, when: o.when, payment: o.payment, paid: o.paid, demo: o.demo,
    items: o.items.map(({ qty, name }) => ({ qty, name })), subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total,
  });
}

// a card order becomes a real order once the payment is confirmed (only once, even if Stripe retries)
async function markPaid(store, env, id, extra = {}) {
  const order = await store.transition(id, "pending_payment", { status: "new", paid: true, paidAt: new Date().toISOString(), ...extra });
  if (order) await notifyNewOrder(order, env);
  return order;
}

async function stripeWebhook({ req, env, store }) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, "webhook_not_configured");
  const raw = await req.text();
  let event;
  try { event = await verifyWebhook(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET); }
  catch { throw new HttpError(400, "bad_signature"); }

  const s = event.data?.object;
  const paidEvent = (event.type === "checkout.session.completed" && s.payment_status === "paid")
    || event.type === "checkout.session.async_payment_succeeded";
  if (paidEvent && s.metadata?.order_id) {
    await markPaid(store, env, s.metadata.order_id, { paymentIntent: s.payment_intent });
  }
  return json({ received: true });
}

async function demoPay({ req, env, store }) {
  if (cardMode(env) !== "demo") throw new HttpError(403, "not_demo");
  const { id } = await body(req);
  const order = await store.get(String(id));
  if (!order) throw new HttpError(404, "not_found");
  await markPaid(store, env, order.id);
  return json({ ok: true });
}

/* ---------- Staff side (admin page) ---------- */

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
const sessionSecret = (env) => env.SESSION_SECRET || `${env.ADMIN_PASSWORD}:ordering-session`;
// compares two strings without leaking how much of them matched
async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(String(s)))));
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

async function adminLogin({ req, env }) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(503, "admin_disabled");
  const { password } = await body(req);
  if (!(await sameText(password ?? "", env.ADMIN_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 800)); // slows down password guessing
    throw new HttpError(401, "wrong_password");
  }
  const exp = Date.now() + 14 * 60 * 60 * 1000; // one working day
  return json({ token: `${exp}.${await hmac(sessionSecret(env), `admin:${exp}`)}` });
}

async function requireAdmin({ req, env }) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(503, "admin_disabled");
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [exp, mac] = token.split(".");
  if (!exp || !mac || +exp < Date.now() || !(await sameText(mac, await hmac(sessionSecret(env), `admin:${exp}`)))) {
    throw new HttpError(401, "login");
  }
}

async function adminOrders({ store }) {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const [orders, availability, requests] = await Promise.all([store.list({ since }), store.getSettings(), store.listRequests()]);
  return json({ orders, availability, requests, serverTime: new Date().toISOString() });
}

async function adminRequestDone({ req, store }) {
  const { id } = await body(req);
  await store.closeRequest(String(id));
  return json({ ok: true });
}

// links for each table's QR code; `site` is the page the codes should open (same site only)
async function adminTables({ env, url }) {
  if (!ORDERING.table?.enabled || !tableSecret(env)) throw new HttpError(400, "table_off");
  let site = `${url.origin}/`;
  try { const s = new URL(url.searchParams.get("site")); if (s.origin === url.origin) site = s.origin + s.pathname; } catch { /* keep default */ }
  const tables = [];
  for (let n = 1; n <= ORDERING.table.tables; n++) tables.push({ n, url: `${site}?table=${n}&key=${await tableKey(env, n)}` });
  return json({ tables });
}

async function adminStatus({ req, store }) {
  const { id, status } = await body(req);
  if (!STATUSES.includes(status)) throw new HttpError(400, "status");
  const order = await store.update(String(id), { status, [`${status}At`]: new Date().toISOString() });
  if (!order) throw new HttpError(404, "not_found");
  return json({ order });
}

async function adminAvailability({ req, store }) {
  const b = await body(req);
  const patch = {};
  if (typeof b.paused === "boolean") patch.paused = b.paused;
  if (Array.isArray(b.soldOut)) patch.soldOut = b.soldOut.map(String).filter((id) => menuIndex.has(id));
  return json({ availability: await store.setSettings(patch) });
}
