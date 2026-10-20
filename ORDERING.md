# Online ordering: how it works and how to reuse it

Customers add dishes from the menu, choose pickup or delivery and a time, then pay online (Stripe) or pay at the counter / on delivery.
The café gets a Telegram message and/or email for each order, and manages orders on a staff page at `/admin/`.

**Table ordering (QR codes):** guests sitting in the café scan the QR code on their table, order from their phone, and pay online or at the end. The order shows on the staff page as "Table 5". Guests also get **Call a waiter** and **Ask for the bill** buttons, which alert staff on Telegram and at the top of the staff page. The café needs fewer waiters walking around taking orders.

- Turn it on and set the number of tables in `js/data.js` → `ORDERING.table`.
- Print the codes from the staff page → **Table QR codes** → **Print QR codes**.
- Each code contains a signed key, so nobody can send orders or waiter calls to a table from outside the café. Set `TABLE_SECRET` **before** printing: if it changes, the printed codes stop working.
- Table orders are only accepted while the kitchen is open (opening hours minus `lastOrderMinutes`).
- On the demo site, `demoLink: true` shows a "Try it as Table 5" link. Set it to `false` for real clients.

---

## 1. Try it on your computer

```
node server/dev.mjs
```

- Site: http://localhost:8888/
- Staff page: http://localhost:8888/admin/ (password is `ADMIN_PASSWORD` in `.env`)

With `DEMO_PAYMENTS=true` in `.env`, "Pay online" opens a **fake payment page** instead of Stripe, so you can test everything with no accounts.
Orders are saved in `data/orders.json`. Order alerts are printed in the terminal.
To start fresh, delete the `data` folder.

On a plain static host like GitHub Pages there is no server to answer, so the ordering buttons stay hidden and the site works as before.

---

## 2. What's where

| File | What it does | Change it per client? |
|---|---|---|
| `js/data.js` → `MENU` | Dishes and prices. Every dish needs a unique `id` | **Yes** |
| `js/data.js` → `HOURS` | Opening hours (also limit pickup/delivery times) | **Yes** |
| `js/data.js` → `ORDERING` | Prep time, delivery fee, minimum order, delivery postcodes, pay-later on/off | **Yes** |
| `js/data.js` → `I18N` `order.*` | All customer-facing ordering text, English + Greek | Phone number in a few lines |
| `ordering/ordering.mjs` | Cart, checkout, order status screen | No |
| `ordering/ordering.css` | Look of the above (uses the site's colour variables) | Colours only if needed |
| `ordering/shared.mjs` | Price and time rules, used by browser **and** server | No |
| `ordering/demo-pay.html` | Fake payment page for demo mode | No |
| `admin/` | Staff orders page (orders, sold-out switches, pause ordering) | Name in titles |
| `server/handler.mjs` | All `/api/*` endpoints; re-checks every price and time | No |
| `server/store.mjs` | Saves orders: Supabase when live, JSON files locally | No |
| `server/stripe.mjs` | Creates Stripe payment pages, checks Stripe webhooks | No |
| `server/notify.mjs` | Telegram and email alerts (text of the messages) | Maybe |
| `server/supabase.sql` | Creates the database tables (run once per client) | No |
| `server/dev.mjs` | Local server | No |
| `netlify/functions/api.mjs`, `netlify.toml` | Netlify hookup | No |
| `.env.example` | List of every setting | No |

**Security notes:** the browser only sends dish ids and quantities. The server recalculates every price from `data.js`, checks the time slot, postcode, minimum order and sold-out list, and accepts card orders only after Stripe confirms payment through a signed webhook.

---

## 3. Going live for a client (about 1–2 hours once you've done it once)

Create every account **in the client's name** (their email). You get access, but they own the account.

1. **Netlify.** Put the site in a GitHub repo, then Netlify → Add new site → Import from GitHub. Publish directory `.` (already in `netlify.toml`). GitHub Pages can't run the server part, so live ordering needs Netlify (free tier is enough).
2. **Supabase** (orders database, free tier): create a project → SQL Editor → paste `server/supabase.sql` → Run.
   Then Project Settings → API: copy the **Project URL** → `SUPABASE_URL` and the **service_role** key → `SUPABASE_SERVICE_KEY` (secret!).
3. **Stripe.** The client signs up and verifies the business (ID, bank account, VAT number). Start in **test mode**:
   - Developers → API keys → secret key `sk_test_…` → `STRIPE_SECRET_KEY`
   - Developers → Webhooks → Add endpoint `https://THEIR-SITE/api/stripe-webhook`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded` → copy the signing secret `whsec_…` → `STRIPE_WEBHOOK_SECRET`
   - Settings → Customer emails → turn on "Successful payments" so customers get a receipt.
4. **Telegram alerts** (free, instant on the owner's phone): in Telegram talk to **@BotFather** → `/newbot` → copy the token → `TELEGRAM_BOT_TOKEN`.
   The owner sends any message to the new bot. Then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the number after `"chat":{"id":` → `TELEGRAM_CHAT_ID`.
   For a staff group: add the bot to the group, send a message there, and use that chat id (it starts with `-`).
5. **Email alerts** (optional): resend.com account, verify the client's domain → `RESEND_API_KEY`, `ORDER_EMAIL_FROM` (e.g. `orders@theircafe.cy`), `ORDER_EMAIL_TO`.
6. **Staff password:** a strong `ADMIN_PASSWORD`, plus a long random `SESSION_SECRET`. If the client takes table ordering, also a long random `TABLE_SECRET`. Print the QR codes only after it's set, then laminate them or put them in table stands.
7. Netlify → Site configuration → Environment variables: add everything above. **Don't** set `DEMO_PAYMENTS`. Redeploy.
8. **Test with Stripe test cards:** `4242 4242 4242 4242`, any future date, any CVC. Check the order arrives on Telegram and at `/admin/`, and the customer's screen moves Received → Preparing → Ready.
9. **Go live:** swap to the live `sk_live_…` key and make a **new live webhook** (live mode has its own `whsec_…`). Place one real €1–2 order and refund it from Stripe.
10. Show the staff `/admin/` on the tablet or phone they'll use, with sound on, and leave the page open during opening hours.

**Before launch, with the client's accountant:** card payments go through Stripe, but the legal receipt (and myDATA in Greece / the tax system in Cyprus) still comes from their till or invoicing system. Agree how staff enter online orders into it. Also add a terms/refund page and a privacy notice.

---

## 4. Reusing this for a new client's site

Copy these into the new site: `ordering/`, `admin/`, `server/`, `netlify/`, `netlify.toml`, `.env.example`, `ORDERING.md`, and add `.env` and `data/` to `.gitignore`.

Then connect it to that site's menu (these are the only changes made to Olive & Oat's own files):

1. **`js/data.js`**: give every menu item an `id`, add `ORDERING` and the `order.*` text, and end the file with
   `if (typeof module !== "undefined") module.exports = { MENU, HOURS, ORDERING, I18N };`
   If the new site's menu has a different shape, adjust `indexMenu()` in `ordering/shared.mjs` (it needs id, price in euros, and the name in each language).
2. **Menu rows**: each dish row gets
   `<button type="button" class="add-btn" data-add="DISH-ID"><span class="add-icon"></span><span class="add-label"></span></button>`
   inside an element with class `menu-item`, plus a `.menu-item-main` for the sold-out label. In Olive & Oat this is in `renderMenu()` in `js/main.js`. The list must be inside `#menu-panel`.
3. **`index.html`**: the `ordering/ordering.css` link, the cart button in the header (`#cart-btn`), and
   `<script type="module" src="ordering/ordering.mjs"></script>` after the site's own scripts.
   Optional: `data-order-only` on anything that should show only when ordering works (like the "Order for pickup" button), and `data-add-current` for an "Add to order" button in a dish popup (`#dish` with `data-item`).
4. **Language switch** (only if the site has one): after switching, run `document.dispatchEvent(new CustomEvent("site:lang"))` and keep `<html lang>` up to date.

Search for "Olive & Oat" in `admin/` and `ordering/demo-pay.html` to change the name.

---

## 5. What it doesn't do yet (possible paid extras)

- Dish options (milk type, sizes, extras with prices)
- Discount codes
- Order printing on a kitchen printer
- Customer SMS when the order is ready
- Staff page in Greek (it's English only for now)
- Delivery areas by map distance (it uses postcode prefixes)
- Automatic refunds from the staff page (refund in the Stripe dashboard)
