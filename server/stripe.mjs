/* =========================================================
   Stripe, through its plain HTTP API (no package to install).
   The customer pays on Stripe's own page, so card details never touch this site.
   ========================================================= */

export async function createCheckoutSession(env, { order, currency, successUrl, cancelUrl }) {
  const p = new URLSearchParams({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: order.id,
    "metadata[order_id]": order.id,
    "payment_intent_data[metadata][order_id]": order.id,
    "payment_intent_data[description]": `Order #${order.number}`,
    locale: order.lang === "el" ? "el" : "en",
    expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60), // Stripe's minimum is 30 minutes
  });
  if (order.customer.email) p.set("customer_email", order.customer.email);
  const lines = order.items.map((l) => ({ name: l.name[order.lang] || l.name.en, unit: l.unit, qty: l.qty }));
  if (order.deliveryFee) lines.push({ name: order.lang === "el" ? "Μεταφορικά" : "Delivery", unit: order.deliveryFee, qty: 1 });
  lines.forEach((l, i) => {
    p.set(`line_items[${i}][quantity]`, String(l.qty));
    p.set(`line_items[${i}][price_data][currency]`, currency);
    p.set(`line_items[${i}][price_data][unit_amount]`, String(l.unit));
    p.set(`line_items[${i}][price_data][product_data][name]`, l.name);
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `checkout-${order.id}`,
    },
    body: p,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data;
}

/* Checks that a webhook really came from Stripe: the stripe-signature header holds
   a timestamp and an HMAC-SHA256 of "timestamp.body" made with the webhook secret. */
export async function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
  if (!header) throw new Error("missing signature");
  const parts = header.split(",").map((kv) => kv.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length) throw new Error("bad header");
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error("too old");

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const same = (a, b) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
  if (!sigs.some((s) => same(s, expected))) throw new Error("signature mismatch");
  return JSON.parse(rawBody);
}
