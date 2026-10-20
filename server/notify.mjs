/* =========================================================
   Tells the café about a new order: Telegram message and/or email,
   whichever is set up in the environment. A failed message never
   cancels the order; the admin page shows every order regardless.
   ========================================================= */

const eur = (c) => "€" + (c / 100).toFixed(2);

function whenText(order) {
  if (order.when === "asap") return "As soon as possible";
  const [date, time] = order.when.split("T");
  const d = new Date(date + "T12:00:00Z");
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}, ${time}`;
}

export function orderText(order) {
  const lines = [
    `${order.demo ? "[DEMO] " : ""}New order #${order.number}`,
    order.type === "table" ? `TABLE ${order.table}` : `${order.type === "delivery" ? "Delivery" : "Pickup"}: ${whenText(order)}`,
    "",
    ...order.items.map((l) => `${l.qty} × ${l.name.en}`),
    "",
    order.deliveryFee ? `Delivery fee ${eur(order.deliveryFee)}` : null,
    `Total ${eur(order.total)}: ${order.payment === "card" ? (order.demo ? "test payment, not real money" : "PAID online") : (order.type === "table" ? "TO PAY at the end" : "TO PAY on " + order.type)}`,
    "",
    order.customer.name || order.customer.phone ? [order.customer.name, order.customer.phone].filter(Boolean).join(" · ") : null,
    order.address ? `${order.address.street}, ${order.address.postcode}${order.address.notes ? ` (${order.address.notes})` : ""}` : null,
    order.notes ? `Note: ${order.notes}` : null,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

async function telegram(env, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

async function email(env, { to, subject, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.ORDER_EMAIL_FROM, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function customerText(order) {
  const el = order.lang === "el";
  const items = order.items.map((l) => `${l.qty} × ${l.name[order.lang] || l.name.en}`).join("\n");
  return el
    ? `Ευχαριστούμε! Λάβαμε την παραγγελία σας #${order.number}.\n\n${items}\n\nΣύνολο ${eur(order.total)}`
    : `Thank you! We've received your order #${order.number}.\n\n${items}\n\nTotal ${eur(order.total)}`;
}

// "Call a waiter" / "bill please" from a table: Telegram only, because it has to be seen within a minute
export async function notifyRequest(request, env) {
  const text = request.kind === "bill" ? `🧾 Table ${request.table} asks for the bill` : `🔔 Table ${request.table} is calling a waiter`;
  if (!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)) { console.log(`\n[table request] ${text}\n`); return; }
  try { await telegram(env, text); } catch (err) { console.error("[ordering] telegram failed:", err.message); }
}

export async function notifyNewOrder(order, env) {
  const text = orderText(order);
  const jobs = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) jobs.push(["telegram", telegram(env, text)]);
  if (env.RESEND_API_KEY && env.ORDER_EMAIL_FROM && env.ORDER_EMAIL_TO) {
    jobs.push(["email to café", email(env, { to: env.ORDER_EMAIL_TO.split(","), subject: `New order #${order.number}`, text })]);
    if (order.customer.email) {
      const subject = order.lang === "el" ? `Η παραγγελία σας #${order.number}` : `Your order #${order.number}`;
      jobs.push(["email to customer", email(env, { to: [order.customer.email], subject, text: customerText(order) })]);
    }
  }
  // with nothing set up (like on your own computer), the message is printed in the terminal instead
  if (!jobs.length) console.log(`\n┌─ order notification (no Telegram/email set up) ─\n│ ${text.split("\n").join("\n│ ")}\n└─\n`);

  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  results.forEach((r, i) => { if (r.status === "rejected") console.error(`[ordering] ${jobs[i][0]} failed:`, r.reason.message); });
}
