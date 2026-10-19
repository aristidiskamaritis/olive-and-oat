/* =========================================================
   Ordering rules shared by the browser and the server:
   prices, delivery and pickup times. The browser uses them to show
   totals; the server runs the same code again before accepting an order.
   All money is in cents.
   ========================================================= */

export const cents = (euros) => Math.round(euros * 100);

export function indexMenu(menu) {
  const byId = new Map();
  for (const cat of menu) {
    for (const it of cat.items) {
      byId.set(it.id, { id: it.id, cat: cat.id, price: cents(it.price), name: { en: it.en[0], el: it.el[0] } });
    }
  }
  return byId;
}

/* ---------- Time (always the café's own time zone) ---------- */

const pad = (n) => String(n).padStart(2, "0");
export const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// the café's local date and time right now
export function localNow(timeZone, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const y = +parts.year, m = +parts.month, d = +parts.day;
  return { date: `${y}-${pad(m)}-${pad(d)}`, day: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), minutes: (+parts.hour % 24) * 60 + +parts.minute };
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`, day: dt.getUTCDay() };
}

/* Times a customer can choose: the rest of today, or, when it's too late
   (or closed), the next day we open. `asap` is offered only while open. */
export function orderTimes(hours, settings, type = "pickup", date = new Date()) {
  const now = localNow(settings.timeZone, date);
  const step = settings.slotMinutes;
  const lead = settings.prepMinutes + (type === "delivery" ? settings.delivery.extraMinutes : 0);

  for (let offset = 0; offset < 8; offset++) {
    const { date: day, day: weekday } = addDays(now.date, offset);
    const h = hours[weekday];
    if (!h) continue;
    const open = toMin(h[0]);
    const lastOrder = toMin(h[1]) - settings.lastOrderMinutes;
    const extra = type === "delivery" ? settings.delivery.extraMinutes : 0;
    const latest = lastOrder + extra;                     // food leaves by last order; delivery lands a bit later
    let first = open + lead;
    if (offset === 0) first = Math.max(first, now.minutes + lead);
    first = Math.ceil(first / step) * step;
    const slots = [];
    for (let m = first; m <= latest; m += step) slots.push({ value: `${day}T${fromMin(m)}`, date: day, weekday, offset, time: fromMin(m) });
    if (!slots.length) continue;
    const openNow = offset === 0 && now.minutes >= open && now.minutes < lastOrder;
    return { openNow, asap: openNow, leadMinutes: lead, slots };
  }
  return { openNow: false, asap: false, leadMinutes: lead, slots: [] };
}

export function isValidTime(value, times) {
  return value === "asap" ? times.asap : times.slots.some((s) => s.value === value);
}

/* ---------- Prices ---------- */

export function postcodeOk(postcode, delivery) {
  const p = String(postcode || "").trim();
  if (!/^\d{4}$/.test(p)) return false;
  return !delivery.postcodes.length || delivery.postcodes.some((prefix) => p.startsWith(prefix));
}

/* Works out the order's lines and total. `errors` lists anything that stops it
   being placed: empty, unknown_item, sold_out, qty, type, min_order, area. */
export function quote(cart, { menuIndex, settings, type = "pickup", postcode = null, soldOut = [] }) {
  const errors = new Set();
  const lines = [];
  for (const { id, qty } of cart) {
    const item = menuIndex.get(id);
    if (!item) { errors.add("unknown_item"); continue; }
    if (!Number.isInteger(qty) || qty < 1 || qty > settings.maxQtyPerItem) { errors.add("qty"); continue; }
    const soldOutNow = soldOut.includes(id);
    if (soldOutNow) errors.add("sold_out");
    lines.push({ id, qty, name: item.name, unit: item.price, total: item.price * qty, soldOut: soldOutNow });
  }
  if (!lines.length) errors.add("empty");
  const subtotal = lines.reduce((s, l) => s + l.total, 0);

  let deliveryFee = 0;
  let missing = 0;
  if (!settings[type] || !settings[type].enabled) errors.add("type");
  if (type === "delivery") {
    const d = settings.delivery;
    const freeOver = d.freeOver == null ? null : cents(d.freeOver);
    deliveryFee = freeOver !== null && subtotal >= freeOver ? 0 : cents(d.fee);
    missing = Math.max(0, cents(d.minOrder) - subtotal);
    if (missing > 0) errors.add("min_order");
    if (postcode !== null && !postcodeOk(postcode, d)) errors.add("area");
  }
  return { lines, subtotal, deliveryFee, total: subtotal + deliveryFee, missing, errors: [...errors] };
}

export const money = (c, lang = "en") => new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-IE", { style: "currency", currency: "EUR" }).format(c / 100);
