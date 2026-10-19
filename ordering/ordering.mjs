/* =========================================================
   Online ordering, customer side: "+" buttons on the menu, the order
   drawer (cart → details → payment) and the live order status screen.
   Uses MENU, HOURS, ORDERING and I18N from js/data.js.
   If the ordering server doesn't answer (e.g. on a plain static host),
   nothing here shows up and the site works exactly as before.
   ========================================================= */
import { indexMenu, orderTimes, quote, money, postcodeOk, localNow } from "./shared.mjs";

const API = new URL("../api/", import.meta.url);
const html = document.documentElement;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const lang = () => (html.lang === "el" ? "el" : "en");
const t = (key, vars = {}) => {
  const s = I18N[lang()]?.[key] ?? I18N.en[key] ?? key;
  return typeof s === "string" ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : s;
};
const eur = (c) => money(c, lang());
const saved = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const api = async (path, init) => {
  const res = await fetch(new URL(path, API), { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
};

const menuIndex = indexMenu(MENU);
let config = null;                                            // { card, demo, payLater, paused, soldOut }
let cart = (saved.get("oo-cart") || []).filter((l) => menuIndex.has(l.id));
const details = Object.assign({ type: "pickup", payment: "card" }, saved.get("oo-details")); // remembered for next time
let view = "cart";                                            // cart | checkout | status
let notice = null;
let statusId = null;
let statusTimer = null;
let lastFocus = null;

const soldOut = (id) => config.soldOut.includes(id);
const count = () => cart.reduce((n, l) => n + l.qty, 0);
const types = () => ["pickup", "delivery"].filter((k) => ORDERING[k].enabled);
const payments = () => [config.card && "card", config.payLater && "later"].filter(Boolean);
const currentQuote = () => quote(cart, {
  menuIndex, settings: ORDERING, type: details.type,
  postcode: details.type === "delivery" && /^\d{4}$/.test(details.postcode || "") ? details.postcode : null,
  soldOut: config.soldOut,
});

/* ---------- Cart ---------- */

function setQty(id, qty) {
  qty = Math.max(0, Math.min(ORDERING.maxQtyPerItem, qty));
  const line = cart.find((l) => l.id === id);
  if (line && qty === 0) cart = cart.filter((l) => l !== line);
  else if (line) line.qty = qty;
  else if (qty > 0) cart.push({ id, qty });
  saved.set("oo-cart", cart);
  syncMenuButtons();
  updateCartButtons();
}
const add = (id) => { if (!soldOut(id)) setQty(id, (cart.find((l) => l.id === id)?.qty || 0) + 1); };

function syncMenuButtons() {
  $$(".add-btn[data-add]").forEach((btn) => {
    const id = btn.dataset.add;
    const qty = cart.find((l) => l.id === id)?.qty || 0;
    const out = soldOut(id);
    btn.disabled = out;
    btn.classList.toggle("is-sold-out", out);
    btn.classList.toggle("in-cart", qty > 0 && !out);
    $(".add-label", btn).textContent = qty > 0 && !out ? `${qty}` : "";
    const main = $(".menu-item-main", btn.closest(".menu-item"));
    const tag = main && $(".sold-tag", main);
    if (out && main && !tag) main.insertAdjacentHTML("beforeend", `<span class="sold-tag">${esc(t("order.soldOut"))}</span>`);
    else if (out && tag) tag.textContent = t("order.soldOut");
    else if (!out && tag) tag.remove();
  });
  const dishBtn = $("[data-add-current]");
  if (dishBtn) {
    const out = soldOut($("#dish").dataset.item);
    dishBtn.disabled = out;
    if (!dishBtn.classList.contains("is-added")) $("span", dishBtn).textContent = out ? t("order.soldOut") : t("order.addToOrder");
  }
}

function updateCartButtons() {
  const n = count();
  const badge = $("#cart-btn .cart-count");
  badge.hidden = n === 0;
  badge.textContent = n;
  const float = $("#cart-float");
  float.hidden = n === 0 || !drawer.hidden;
  $(".cf-count", float).textContent = n;
  $(".cf-total", float).textContent = eur(currentQuote().subtotal);
}

function bump(el) {
  el.classList.remove("bump");
  void el.offsetWidth; // restarts the animation
  el.classList.add("bump");
}

/* ---------- Drawer ---------- */

const drawer = document.createElement("div");
drawer.className = "cart";
drawer.id = "cart";
drawer.hidden = true;
drawer.setAttribute("role", "dialog");
drawer.setAttribute("aria-modal", "true");
drawer.setAttribute("aria-labelledby", "cart-title");
drawer.innerHTML = `
  <div class="cart-backdrop"></div>
  <aside class="cart-panel">
    <header class="cart-head">
      <button type="button" class="cart-icon-btn cart-back" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <h2 id="cart-title"></h2>
      <button type="button" class="cart-icon-btn cart-close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    </header>
    <div class="cart-body"></div>
    <footer class="cart-foot"></footer>
  </aside>`;
const body = $(".cart-body", drawer);
const foot = $(".cart-foot", drawer);

const floatBtn = document.createElement("button");
floatBtn.type = "button";
floatBtn.id = "cart-float";
floatBtn.className = "cart-float";
floatBtn.hidden = true;
floatBtn.innerHTML = `<span class="cf-count">0</span><span class="cf-label"></span><span class="cf-total"></span>`;

function openDrawer(next = "cart") {
  view = next;
  if (drawer.hidden) {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    html.style.overflow = "hidden";
    document.body.classList.add("cart-open");
    requestAnimationFrame(() => drawer.classList.add("is-open"));
  }
  render();
  updateCartButtons();
  $(".cart-close", drawer).focus({ preventScroll: true });
}

function closeDrawer() {
  if (drawer.hidden) return;
  drawer.classList.remove("is-open");
  clearTimeout(statusTimer);
  if (new URLSearchParams(location.search).has("order")) history.replaceState(null, "", location.pathname + location.hash);
  setTimeout(() => {
    drawer.hidden = true;
    html.style.overflow = "";
    document.body.classList.remove("cart-open");
    updateCartButtons();
    lastFocus?.focus({ preventScroll: true });
  }, 320);
}

function render() {
  $(".cart-back", drawer).hidden = view !== "checkout";
  $(".cart-back", drawer).setAttribute("aria-label", t("order.back"));
  $(".cart-close", drawer).setAttribute("aria-label", t("order.close"));
  $("#cart-title").textContent = view === "status" ? "" : t("order.title");
  ({ cart: renderCart, checkout: renderCheckout, status: renderStatus })[view]();
}

const noticeHtml = () => notice ? `<p class="cart-notice ${notice.kind}" role="alert">${esc(notice.text)}</p>` : "";
const pausedHtml = () => config.paused ? `<p class="cart-notice error">${esc(t("order.paused"))}</p>` : "";
const row = (label, value, cls = "") => `<div class="sum-row ${cls}"><span>${label}</span><span>${value}</span></div>`;

function renderCart() {
  const q = currentQuote();
  if (!cart.length) {
    body.innerHTML = `${noticeHtml()}${pausedHtml()}
      <div class="cart-empty">
        <p>${esc(t("order.empty"))}</p>
        <button type="button" class="btn btn-primary btn-sm" data-browse>${esc(t("order.browse"))}</button>
      </div>`;
    foot.innerHTML = "";
    return;
  }
  body.innerHTML = `${noticeHtml()}${pausedHtml()}
    <ul class="cart-lines">
      ${q.lines.map((l) => `
        <li class="cart-line${l.soldOut ? " is-sold-out" : ""}">
          <div class="cl-main">
            <strong>${esc(l.name[lang()])}</strong>
            <span>${l.soldOut ? esc(t("order.soldOut")) : eur(l.unit)}</span>
          </div>
          <div class="qty" role="group" aria-label="${esc(l.name[lang()])}">
            <button type="button" data-qty="${l.id}" data-step="-1" aria-label="${esc(t("order.less"))}">−</button>
            <output aria-live="polite">${l.qty}</output>
            <button type="button" data-qty="${l.id}" data-step="1" aria-label="${esc(t("order.more"))}" ${l.soldOut ? "disabled" : ""}>+</button>
          </div>
          <span class="cl-total">${eur(l.total)}</span>
        </li>`).join("")}
    </ul>`;
  const blocked = config.paused || q.errors.includes("sold_out");
  foot.innerHTML = `${row(t("order.subtotal"), eur(q.subtotal), "total")}
    <button type="button" class="btn btn-primary btn-block" data-go="checkout" ${blocked ? "disabled" : ""}>${esc(t("order.next"))}</button>`;
}

function slotLabel(value) {
  if (value === "asap") return t("order.asapShort");
  const [date, time] = value.split("T");
  const today = localNow(ORDERING.timeZone).date;
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 864e5);
  if (diff === 0) return t("order.slotToday", { time });
  if (diff === 1) return t("order.slotTomorrow", { time });
  return t("order.slotDay", { day: t("days")[new Date(date + "T12:00:00Z").getUTCDay()], time });
}

function field(name, label, { type = "text", value = "", auto = "", extra = "", error = "" } = {}) {
  return `<div class="field">
    <label for="co-${name}">${label}</label>
    <input id="co-${name}" name="${name}" type="${type}" value="${esc(value)}" ${auto ? `autocomplete="${auto}"` : ""} ${extra}>
    ${error ? `<p class="error">${esc(error)}</p>` : ""}
  </div>`;
}

function renderCheckout() {
  if (!types().includes(details.type)) details.type = types()[0];
  if (!payments().includes(details.payment)) details.payment = payments()[0];
  const times = orderTimes(HOURS, ORDERING, details.type);
  if (!times.asap && details.when === "asap") details.when = null;
  const first = times.slots[0];
  const delivery = details.type === "delivery";

  body.innerHTML = `${noticeHtml()}${pausedHtml()}
    ${config.demo ? `<p class="cart-notice demo">${esc(t("order.demo"))}</p>` : ""}
    <form id="checkout-form" class="checkout" novalidate>
      ${types().length > 1 ? `
        <div class="seg" role="radiogroup">
          ${types().map((k) => `<label><input type="radio" name="type" value="${k}" ${details.type === k ? "checked" : ""}><span>${esc(t("order." + k))}</span></label>`).join("")}
        </div>` : ""}

      ${!times.openNow && first ? `<p class="cart-notice info">${esc(t("order.preorder", {
        day: first.offset === 0 ? t("status.today") : first.offset === 1 ? t("status.tomorrow") : t("days")[first.weekday], time: first.time,
      }))}</p>` : ""}
      <div class="field">
        <label for="co-when">${esc(t("order.when"))}</label>
        <select id="co-when" name="when">
          ${times.asap ? `<option value="asap">${esc(t("order.asap", { min: times.leadMinutes }))}</option>` : ""}
          ${times.slots.map((s) => `<option value="${s.value}" ${details.when === s.value ? "selected" : ""}>${esc(slotLabel(s.value))}</option>`).join("")}
        </select>
        <p class="error">${esc(t("order.err.slot"))}</p>
      </div>

      <div class="co-delivery" ${delivery ? "" : "hidden"}>
        <div class="field-row two">
          ${field("street", esc(t("order.street")), { value: details.street, auto: "street-address", error: t("order.err.street") })}
          ${field("postcode", esc(t("order.postcode")), { value: details.postcode, auto: "postal-code", extra: 'inputmode="numeric" maxlength="4"', error: t("order.err.postcode") })}
        </div>
        ${field("addressNotes", t("order.addressNotes"), { value: details.addressNotes })}
      </div>

      ${field("name", t("form.name"), { value: details.name, auto: "name", error: t("form.err.name") })}
      <div class="field-row two">
        ${field("phone", t("form.phone"), { type: "tel", value: details.phone, auto: "tel", extra: 'inputmode="tel" placeholder="+357 99 000000"', error: t("form.err.phone") })}
        ${field("email", t("form.email"), { type: "email", value: details.email, auto: "email", error: t("form.err.email") })}
      </div>
      <div class="field">
        <label for="co-notes">${t("order.notes")}</label>
        <textarea id="co-notes" name="notes" rows="2" placeholder="${esc(t("order.notesPh"))}">${esc(details.notes || "")}</textarea>
      </div>

      ${payments().length > 1 ? `
        <fieldset class="pay">
          <legend>${esc(t("order.payment"))}</legend>
          <label class="pay-opt${details.payment === "card" ? " on" : ""}"><input type="radio" name="payment" value="card" ${details.payment === "card" ? "checked" : ""}>
            <span><strong>${esc(t("order.payCard"))}</strong><small>${esc(t("order.payCardSub"))}</small></span></label>
          <label class="pay-opt${details.payment === "later" ? " on" : ""}"><input type="radio" name="payment" value="later" ${details.payment === "later" ? "checked" : ""}>
            <span><strong>${esc(t(delivery ? "order.payLaterDelivery" : "order.payLaterPickup"))}</strong><small>${esc(t("order.payLaterSub"))}</small></span></label>
        </fieldset>` : ""}
    </form>`;
  if (details.when && $(`#co-when option[value="${details.when}"]`)) $("#co-when").value = details.when;
  details.when = $("#co-when").value || null;
  renderCheckoutFoot();
}

function renderCheckoutFoot() {
  const q = currentQuote();
  const delivery = details.type === "delivery";
  const d = ORDERING.delivery;
  let hint = "";
  if (delivery && q.missing > 0) hint = t("order.minOrder", { min: eur(d.minOrder * 100), more: eur(q.missing) });
  else if (delivery && q.deliveryFee > 0 && d.freeOver != null) hint = t("order.freeOver", { amount: eur(d.freeOver * 100) });
  const label = details.payment === "card" ? "order.goPay" : "order.place";
  foot.innerHTML = `
    ${delivery ? row(t("order.subtotal"), eur(q.subtotal)) + row(t("order.deliveryFee"), q.deliveryFee ? eur(q.deliveryFee) : t("order.free")) : ""}
    ${row(t("order.total"), eur(q.total), "total")}
    ${hint ? `<p class="cart-hint">${esc(hint)}</p>` : ""}
    <button type="submit" form="checkout-form" class="btn btn-primary btn-block" ${config.paused || q.missing > 0 || !$("#co-when").value ? "disabled" : ""}>${esc(t(label, { total: eur(q.total) }))}</button>`;
}

const checks = {
  name: (v) => v.trim().length >= 2,
  phone: (v) => /^[+0-9 ()-]{8,}$/.test(v.trim()),
  email: (v) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  street: (v) => details.type !== "delivery" || v.trim().length >= 3,
  postcode: (v) => details.type !== "delivery" || /^\d{4}$/.test(v.trim()),
};
function checkField(input) {
  const ok = checks[input.name] ? checks[input.name](input.value) : true;
  input.closest(".field")?.classList.toggle("invalid", !ok);
  input.setAttribute("aria-invalid", String(!ok));
  return ok;
}

async function submitOrder(form) {
  notice = null;
  const inputs = $$("input[name]:not([type=radio]), select", form).filter((el) => !el.closest("[hidden]"));
  const bad = inputs.filter((el) => !checkField(el));
  if (details.type === "delivery" && !bad.some((el) => el.name === "postcode") && !postcodeOk(details.postcode, ORDERING.delivery)) {
    notice = { kind: "error", text: t("order.err.area") };
  }
  if (bad.length || notice) {
    if (notice) { $(".cart-notice.error", body)?.remove(); body.insertAdjacentHTML("afterbegin", noticeHtml()); body.scrollTop = 0; }
    bad[0]?.focus();
    return;
  }

  const btn = $("button[type=submit]", foot);
  btn.disabled = true;
  btn.textContent = t("order.sending");
  const order = {
    items: cart, type: details.type, when: details.when, payment: details.payment, lang: lang(),
    customer: { name: details.name, phone: details.phone, email: details.email },
    address: details.type === "delivery" ? { street: details.street, postcode: details.postcode, notes: details.addressNotes } : null,
    notes: details.notes, returnUrl: location.origin + location.pathname,
  };
  try {
    const { ok, data } = await api("checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(order) });
    if (ok && data.url) {
      saved.set("oo-pending", new URL(data.url, location.href).searchParams.get("order"));
      location.href = data.url;
      return;
    }
    await refreshConfig();
    const code = data.error;
    if (code === "sold_out" || code === "paused") { notice = { kind: "error", text: t(code === "paused" ? "order.paused" : "order.err.sold_out") }; openDrawer("cart"); return; }
    notice = { kind: "error", text: t({ slot: "order.err.slot", area: "order.err.area", street: "order.err.street" }[code] || "order.err.generic") };
  } catch {
    notice = { kind: "error", text: t("order.err.generic") };
  }
  renderCheckout();
  body.scrollTop = 0;
}

/* ---------- Order status (after paying, or straight away when paying later) ---------- */

const STEPS = ["new", "preparing", "ready", "completed"];

async function loadStatus() {
  clearTimeout(statusTimer);
  const { ok, data } = await api(`order?id=${encodeURIComponent(statusId)}`).catch(() => ({ ok: false }));
  if (drawer.hidden || view !== "status") return;
  if (!ok) { body.innerHTML = `<p class="cart-notice error">${esc(t("order.err.generic"))}</p>`; foot.innerHTML = ""; return; }

  // the order went through: empty the cart it came from
  if (data.status !== "pending_payment" && saved.get("oo-pending") === statusId) {
    cart = [];
    saved.set("oo-cart", cart);
    saved.set("oo-pending", null);
    syncMenuButtons();
    updateCartButtons();
  }
  const s = data.status;
  const message = s === "ready" ? t(`order.st.ready.${data.type}`) : t(`order.st.${s}`);
  const step = STEPS.indexOf(s);
  const when = t(data.type === "delivery" ? "order.whenDelivery" : "order.whenPickup", { when: slotLabel(data.when) });
  const payLine = data.paid ? t("order.paidOnline")
    : t("order.toPay", { type: t(data.type === "delivery" ? "order.toPayDelivery" : "order.toPayPickup"), total: eur(data.total) });

  body.innerHTML = `
    <div class="status status-${s}">
      <div class="status-icon" aria-hidden="true">${s === "cancelled" ? "!" : s === "pending_payment" ? '<span class="spinner"></span>' : '<svg viewBox="0 0 64 64"><path d="M20 33l8 8 16-17" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'}</div>
      <p class="eyebrow">${esc(t("order.number", { number: data.number }))}</p>
      <h3 aria-live="polite">${esc(message)}</h3>
      ${step >= 0 ? `<ol class="steps">${STEPS.slice(0, 3).map((k, i) => `<li class="${i <= step ? "done" : ""}">${esc(t(`order.step.${k}`))}</li>`).join("")}</ol>` : ""}
      <p class="status-when">${esc(when)}</p>
      <ul class="status-items">${data.items.map((l) => `<li><span>${l.qty} ×</span> ${esc(l.name[lang()] || l.name.en)}</li>`).join("")}</ul>
      ${row(t("order.total"), eur(data.total), "total")}
      <p class="status-pay">${esc(payLine)}</p>
      ${data.demo ? `<p class="cart-notice demo">${esc(t("order.demo"))}</p>` : ""}
      ${["completed", "cancelled"].includes(s) ? "" : `<p class="status-live">${esc(t("order.live"))}</p>`}
    </div>`;
  foot.innerHTML = `<button type="button" class="btn btn-primary btn-block" data-new-order>${esc(t("order.newOrder"))}</button>`;
  if (!["completed", "cancelled"].includes(s)) statusTimer = setTimeout(loadStatus, s === "pending_payment" ? 2500 : 10000);
}

function renderStatus() {
  if (!body.querySelector(".status")) {
    body.innerHTML = `<div class="status"><div class="status-icon"><span class="spinner"></span></div></div>`;
    foot.innerHTML = "";
  }
  loadStatus();
}

/* ---------- Events ---------- */

document.addEventListener("click", (e) => {
  const addBtn = e.target.closest(".add-btn[data-add]");
  if (addBtn) { add(addBtn.dataset.add); bump(addBtn); bump($("#cart-btn")); return; }

  const dishBtn = e.target.closest("[data-add-current]");
  if (dishBtn) {
    add($("#dish").dataset.item);
    dishBtn.classList.add("is-added");
    $("span", dishBtn).textContent = `${t("order.added")} ✓`;
    setTimeout(() => { dishBtn.classList.remove("is-added"); syncMenuButtons(); }, 1400);
    return;
  }
  if (e.target.closest("#cart-btn, #cart-float")) { notice = null; openDrawer("cart"); return; }
  if (!drawer.contains(e.target)) return;

  if (e.target.closest(".cart-close") || e.target.classList.contains("cart-backdrop")) closeDrawer();
  else if (e.target.closest(".cart-back")) { notice = null; openDrawer("cart"); }
  else if (e.target.closest("[data-go=checkout]")) { notice = null; openDrawer("checkout"); }
  else if (e.target.closest("[data-qty]")) {
    const b = e.target.closest("[data-qty]");
    setQty(b.dataset.qty, (cart.find((l) => l.id === b.dataset.qty)?.qty || 0) + Number(b.dataset.step));
    renderCart();
    $(`[data-qty="${b.dataset.qty}"][data-step="${b.dataset.step}"]`, body)?.focus();
  } else if (e.target.closest("[data-browse]")) {
    closeDrawer();
    setTimeout(() => $("#menu").scrollIntoView({ behavior: "smooth" }), 330);
  } else if (e.target.closest("[data-new-order]")) {
    closeDrawer();
  }
});

drawer.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.name || !el.closest("#checkout-form")) return;
  details[el.name] = el.value;
  saved.set("oo-details", { ...details, when: undefined, notes: undefined });
  if (el.closest(".field")?.classList.contains("invalid")) checkField(el);
  if (el.name === "type") { notice = null; renderCheckout(); return; }
  if (el.name === "payment") {
    $$(".pay-opt", body).forEach((o) => o.classList.toggle("on", $("input", o).checked));
  }
  renderCheckoutFoot();
});
drawer.addEventListener("focusout", (e) => { if (e.target.name && e.target.value && e.target.closest("#checkout-form")) checkField(e.target); });
drawer.addEventListener("submit", (e) => { e.preventDefault(); submitOrder(e.target); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.hidden) closeDrawer(); });

document.addEventListener("site:lang", () => {
  $(".cf-label", floatBtn).textContent = t("order.open");
  syncMenuButtons();
  updateCartButtons();
  if (!drawer.hidden) render();
});

async function refreshConfig() {
  const { ok, data } = await api("config");
  if (ok) config = data;
  return ok;
}

/* ---------- Start ---------- */

async function start() {
  const ok = await refreshConfig().catch(() => false);
  if (!ok) return; // no ordering server here: leave the site as it was
  document.body.append(drawer, floatBtn);
  html.classList.add("ordering-on");
  $(".cf-label", floatBtn).textContent = t("order.open");

  // menu rows are re-drawn when tabs, filters or language change
  new MutationObserver(syncMenuButtons).observe($("#menu-panel"), { childList: true });
  new MutationObserver(syncMenuButtons).observe($("#dish"), { attributes: true, attributeFilter: ["data-item"] });
  syncMenuButtons();
  updateCartButtons();

  const params = new URLSearchParams(location.search);
  if (params.get("order")) {
    statusId = params.get("order");
    openDrawer("status");
  } else if (params.get("checkout") === "cancelled") {
    history.replaceState(null, "", location.pathname + location.hash);
    notice = { kind: "info", text: t("order.cancelled") };
    openDrawer("cart");
  }
  // keep sold-out items and the pause switch fresh while the page is open
  setInterval(async () => { if (await refreshConfig()) { syncMenuButtons(); if (!drawer.hidden && view === "cart") renderCart(); } }, 60000);
}
start();
