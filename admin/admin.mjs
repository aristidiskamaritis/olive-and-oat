/* =========================================================
   Staff orders board: new orders appear by themselves (with a sound),
   staff move them through preparing → ready → completed, and can mark
   dishes sold out or pause online ordering. Tables calling a waiter or
   asking for the bill show at the top, and the Tables tab prints each
   table's QR code.
   ========================================================= */
import { indexMenu } from "../ordering/shared.mjs";

const API = new URL("../api/", import.meta.url);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (c) => "€" + (c / 100).toFixed(2);
const menuIndex = indexMenu(MENU);

let token = sessionStorage.getItem("oo-admin") || "";
let tab = "active";
let orders = [];
let availability = { paused: false, soldOut: [] };
let requests = [];
let tableLinks = null;           // [{ n, url }] once the Tables tab has been opened
let seen = null;                 // order ids already shown, so only really new ones ring
let soundOn = localStorage.getItem("oo-admin-sound") !== "off";
let timer = null;

async function call(path, body) {
  const res = await fetch(new URL(path, API), {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "admin/login") { showLogin(); throw new Error("login"); }
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

/* ---------- Sign in ---------- */

function showLogin(message) {
  clearTimeout(timer);
  token = "";
  sessionStorage.removeItem("oo-admin");
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-err").hidden = !message;
  $("#login-err").textContent = message || "";
  $("#pw").focus();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("button", e.target);
  btn.disabled = true;
  try {
    const { token: t } = await call("admin/login", { password: $("#pw").value });
    token = t;
    sessionStorage.setItem("oo-admin", token);
    $("#pw").value = "";
    start();
  } catch (err) {
    showLogin(err.message === "admin_disabled" ? "Admin is switched off: set ADMIN_PASSWORD on the server." : "Wrong password.");
  } finally {
    btn.disabled = false;
  }
});
$("#logout").addEventListener("click", () => showLogin());

/* ---------- Loading orders ---------- */

async function refresh() {
  clearTimeout(timer);
  try {
    const data = await call("admin/orders");
    orders = data.orders;
    availability = data.availability;
    requests = data.requests || [];
    const fresh = [...orders.filter((o) => o.status === "new"), ...requests].filter((x) => seen && !seen.has(x.id));
    if (fresh.length) ring();
    seen = new Set([...orders, ...requests].map((x) => x.id));
    render();
    $("#updated").textContent = `Updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · refreshes every 10 seconds`;
  } catch (err) {
    if (err.message === "login") return;
    $("#updated").textContent = "Can't reach the server. Retrying…";
  }
  timer = setTimeout(refresh, 10000);
}

function start() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  seen = null;
  updateSoundButton();
  refresh();
}

/* ---------- Sound + title alert for new orders ---------- */

let audio = null;
function ring() {
  const waiting = orders.filter((o) => o.status === "new").length + requests.length;
  document.title = `(${waiting}) New · Olive & Oat`;
  if (!soundOn) return;
  try {
    audio = audio || new AudioContext();
    [0, 0.18, 0.36].forEach((at, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = [880, 1175, 1568][i];
      gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.4);
    });
  } catch { /* no audio available */ }
}
function updateSoundButton() { $("#sound").textContent = soundOn ? "🔔 Sound on" : "🔕 Sound off"; }
$("#sound").addEventListener("click", () => {
  soundOn = !soundOn;
  localStorage.setItem("oo-admin-sound", soundOn ? "on" : "off");
  updateSoundButton();
  if (soundOn) ring(); // also unlocks audio in browsers that need a click first
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.title = "Orders · Olive & Oat"; });

/* ---------- Rendering ---------- */

const ACTIVE = ["new", "preparing", "ready"];
const NEXT = {
  new: ["preparing", "Start preparing"],
  preparing: ["ready", "Ready"],
  ready: ["completed", "Completed"],
};
const NEXT_TABLE = { ...NEXT, ready: ["completed", "Served"] };
const LABEL = { new: "New", preparing: "Preparing", ready: "Ready", completed: "Completed", cancelled: "Cancelled" };

function whenText(o) {
  if (o.type === "table") return "now";
  if (o.when === "asap") return "ASAP";
  const [date, time] = o.when.split("T");
  const today = new Date().toLocaleDateString("en-CA");
  return date === today ? time : `${new Date(date + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}
// orders the kitchen should make first come first: by requested time, ASAP by when they came in
const dueAt = (o) => o.when === "asap" ? o.createdAt : new Date(o.when).toISOString();
const placed = (o) => new Date(o.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function card(o) {
  const next = (o.type === "table" ? NEXT_TABLE : NEXT)[o.status];
  const type = o.type === "table" ? `Table ${o.table}` : o.type === "delivery" ? "Delivery" : "Pickup";
  return `
    <article class="order st-${o.status}">
      <header>
        <span class="num">#${o.number}</span>
        <span class="badge">${LABEL[o.status]}</span>
        <span class="type ${o.type}">${type} · <strong>${esc(whenText(o))}</strong></span>
      </header>
      <ul class="items">${o.items.map((l) => `<li><b>${l.qty}×</b> ${esc(l.name.en)}</li>`).join("")}</ul>
      ${o.notes ? `<p class="note">📝 ${esc(o.notes)}</p>` : ""}
      <div class="who">
        ${o.customer.name ? `<span>${esc(o.customer.name)}</span>` : ""}
        ${o.customer.phone ? `<a href="tel:${esc(o.customer.phone.replace(/[^+0-9]/g, ""))}">${esc(o.customer.phone)}</a>` : ""}
        ${o.address ? `<span class="addr">📍 ${esc(o.address.street)}, ${esc(o.address.postcode)}${o.address.notes ? ` · ${esc(o.address.notes)}` : ""}</span>` : ""}
      </div>
      <footer>
        <span class="money ${o.paid ? "paid" : "due"}">${eur(o.total)} · ${o.paid ? (o.demo ? "Paid (test)" : "Paid online") : "To pay"}</span>
        <span class="placed">Placed ${placed(o)}</span>
      </footer>
      <div class="actions">
        ${next ? `<button type="button" class="primary" data-id="${o.id}" data-status="${next[0]}">${next[1]}</button>` : ""}
        ${o.status === "completed" || o.status === "cancelled" ? `<button type="button" data-id="${o.id}" data-status="new">Reopen</button>` : ""}
        ${ACTIVE.includes(o.status) ? `<button type="button" class="danger" data-id="${o.id}" data-status="cancelled">Cancel</button>` : ""}
      </div>
    </article>`;
}

function render() {
  const active = orders.filter((o) => ACTIVE.includes(o.status)).sort((a, b) => dueAt(a).localeCompare(dueAt(b)));
  const done = orders.filter((o) => !ACTIVE.includes(o.status));
  $("#n-active").textContent = active.length;
  $("#n-done").textContent = done.length;
  $("#n-active").textContent = active.length + requests.length;
  $("#accepting").checked = !availability.paused;
  $("#accepting-text").textContent = availability.paused ? "Orders paused" : "Taking orders";
  document.body.classList.toggle("paused", availability.paused);
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

  const board = $("#board");
  if (tab === "menu") {
    board.className = "board menu-board";
    board.innerHTML = MENU.map((cat) => `
      <section>
        <h2>${esc(cat.name.en)}</h2>
        ${cat.items.map((it) => {
          const out = availability.soldOut.includes(it.id);
          return `<label class="avail ${out ? "out" : ""}">
            <span>${esc(it.en[0])} <small>${eur(menuIndex.get(it.id).price)}</small></span>
            <span class="switch"><input type="checkbox" data-item="${it.id}" ${out ? "" : "checked"}><span class="switch-ui"></span>
            <span class="switch-text">${out ? "Sold out" : "Available"}</span></span>
          </label>`;
        }).join("")}
      </section>`).join("");
    return;
  }
  if (tab === "tables") { renderTables(board); return; }
  const list = tab === "active" ? active : done;
  board.className = "board";
  const alerts = tab === "active" && requests.length ? `<div class="requests">${requests.map((r) => `
      <div class="request ${r.kind}">
        <span>${r.kind === "bill" ? "🧾" : "🔔"} <strong>Table ${r.table}</strong> ${r.kind === "bill" ? "asks for the bill" : "is calling a waiter"}</span>
        <small>${placed(r)}</small>
        <button type="button" data-request-done="${r.id}">Done</button>
      </div>`).join("")}</div>` : "";
  board.innerHTML = alerts + (list.length ? list.map(card).join("")
    : `<p class="empty">${tab === "active" ? "No open orders right now. New ones appear here by themselves." : "Nothing finished in the last 3 days."}</p>`);
}

/* ---------- Table QR codes ---------- */

async function renderTables(board) {
  board.className = "board qr-board";
  if (!tableLinks) {
    board.innerHTML = `<p class="empty">Loading QR codes…</p>`;
    try { tableLinks = (await call(`admin/tables?site=${encodeURIComponent(new URL("../", location.href).href)}`)).tables; }
    catch { board.innerHTML = `<p class="empty">Table ordering is switched off. Turn it on in js/data.js (ORDERING.table).</p>`; return; }
    if (tab !== "tables") return;
  }
  board.innerHTML = `
    <div class="qr-head">
      <p>Print these and put each one on its table. Guests scan it, order and pay from their phone, and the order shows here as that table.</p>
      <button type="button" class="primary" id="print-qr">Print QR codes</button>
    </div>
    ${tableLinks.map((t) => `
      <figure class="qr-card">
        <div class="qr" data-url="${esc(t.url)}"></div>
        <figcaption><strong>Table ${t.n}</strong><span>Scan to order · Σκανάρετε για παραγγελία</span></figcaption>
      </figure>`).join("")}`;
  if (typeof QRCode === "undefined") {
    $$(".qr", board).forEach((el) => { el.textContent = el.dataset.url; el.classList.add("qr-text"); });
    return;
  }
  $$(".qr", board).forEach((el) => new QRCode(el, { text: el.dataset.url, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M }));
}

/* ---------- Actions ---------- */

$(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) { tab = b.dataset.tab; render(); }
});

$("#board").addEventListener("click", async (e) => {
  const doneBtn = e.target.closest("[data-request-done]");
  if (doneBtn) {
    doneBtn.disabled = true;
    try { await call("admin/request-done", { id: doneBtn.dataset.requestDone }); } catch { alert("Couldn't update. Check the connection and try again."); }
    refresh();
    return;
  }
  if (e.target.closest("#print-qr")) { window.print(); return; }
  const b = e.target.closest("button[data-status]");
  if (!b) return;
  const o = orders.find((x) => x.id === b.dataset.id);
  if (b.dataset.status === "cancelled") {
    const refundNote = o.paid && !o.demo ? "\n\nIt was paid online: refund it in the Stripe dashboard (Payments → this payment → Refund)." : "";
    if (!confirm(`Cancel order #${o.number}?${refundNote}`)) return;
  }
  b.disabled = true;
  try {
    await call("admin/status", { id: b.dataset.id, status: b.dataset.status });
    document.title = "Orders · Olive & Oat";
  } catch { alert("Couldn't update the order. Check the connection and try again."); }
  refresh();
});

$("#board").addEventListener("change", async (e) => {
  const input = e.target.closest("input[data-item]");
  if (!input) return;
  const soldOut = new Set(availability.soldOut);
  input.checked ? soldOut.delete(input.dataset.item) : soldOut.add(input.dataset.item);
  try { availability = (await call("admin/availability", { soldOut: [...soldOut] })).availability; }
  catch { alert("Couldn't save. Check the connection and try again."); }
  render();
});

$("#accepting").addEventListener("change", async (e) => {
  const paused = !e.target.checked;
  if (paused && !confirm("Pause online orders? Customers will see a message asking them to call instead.")) { e.target.checked = true; return; }
  try { availability = (await call("admin/availability", { paused })).availability; }
  catch { alert("Couldn't save. Check the connection and try again."); }
  render();
});

if (token) start(); else showLogin();
