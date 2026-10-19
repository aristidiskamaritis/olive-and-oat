/* =========================================================
   Where orders are kept.
   - Supabase (when SUPABASE_URL is set): for the live site. Table setup in server/supabase.sql.
   - JSON files in data/ (otherwise): for running on your own computer only.
   Both offer the same functions, so the rest of the code doesn't care which one is used.
   ========================================================= */

const DEFAULT_SETTINGS = { paused: false, soldOut: [] };

let cached = null;
export function getStore(env) {
  if (!cached) cached = env.SUPABASE_URL ? supabaseStore(env) : fileStore(env.DATA_DIR || "data");
  return cached;
}

/* ---------- Local JSON files ---------- */

function fileStore(dir) {
  let queue = Promise.resolve(); // one write at a time, so two orders can't overwrite each other
  const fs = () => import("node:fs/promises");
  const file = (name) => `${dir}/${name}.json`;

  async function read(name, fallback) {
    try { return JSON.parse(await (await fs()).readFile(file(name), "utf8")); }
    catch (e) { if (e.code === "ENOENT") return structuredClone(fallback); throw e; }
  }
  async function write(name, value) {
    const f = await fs();
    await f.mkdir(dir, { recursive: true });
    await f.writeFile(file(name) + ".tmp", JSON.stringify(value, null, 2));
    await f.rename(file(name) + ".tmp", file(name));
  }
  const locked = (fn) => (queue = queue.then(fn, fn));
  const orders = () => read("orders", { seq: 1000, orders: [] });

  return {
    create: (order) => locked(async () => {
      const db = await orders();
      const saved = { ...order, number: ++db.seq };
      db.orders.push(saved);
      await write("orders", db);
      return saved;
    }),
    get: async (id) => (await orders()).orders.find((o) => o.id === id) || null,
    update: (id, patch) => locked(async () => {
      const db = await orders();
      const o = db.orders.find((x) => x.id === id);
      if (!o) return null;
      Object.assign(o, patch);
      await write("orders", db);
      return o;
    }),
    // changes the order only if it still has status `from`; returns null otherwise
    transition: (id, from, patch) => locked(async () => {
      const db = await orders();
      const o = db.orders.find((x) => x.id === id);
      if (!o || o.status !== from) return null;
      Object.assign(o, patch);
      await write("orders", db);
      return o;
    }),
    list: async ({ since }) => (await orders()).orders
      .filter((o) => o.status !== "pending_payment" && o.createdAt >= since)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    getSettings: async () => ({ ...DEFAULT_SETTINGS, ...(await read("settings", {})) }),
    setSettings: (patch) => locked(async () => {
      const next = { ...DEFAULT_SETTINGS, ...(await read("settings", {})), ...patch };
      await write("settings", next);
      return next;
    }),
  };
}

/* ---------- Supabase (Postgres) through its REST API ---------- */

function supabaseStore(env) {
  const base = env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1";
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
  };
  async function call(path, init = {}) {
    const res = await fetch(base + path, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
  // a row keeps the fields we filter on as columns and the rest of the order in `data`
  const toRow = ({ id, number, status, paid, total, createdAt, ...rest }) =>
    ({ id, status, paid, total, created_at: createdAt, data: rest });
  const fromRow = (r) => r && ({ ...r.data, id: r.id, number: r.number, status: r.status, paid: r.paid, total: r.total, createdAt: r.created_at });
  const ret = { prefer: "return=representation" };

  async function patch(filter, changes) {
    const current = (await call(`/orders?${filter}&select=*`))[0];
    if (!current) return null;
    const next = toRow({ ...fromRow(current), ...changes });
    delete next.id;
    delete next.created_at;
    const rows = await call(`/orders?${filter}`, { method: "PATCH", headers: ret, body: JSON.stringify(next) });
    return fromRow(rows[0]);
  }

  return {
    create: async (order) => fromRow((await call("/orders", { method: "POST", headers: ret, body: JSON.stringify(toRow(order)) }))[0]),
    get: async (id) => fromRow((await call(`/orders?id=eq.${encodeURIComponent(id)}&select=*`))[0]),
    update: (id, changes) => patch(`id=eq.${encodeURIComponent(id)}`, changes),
    // the status filter makes the PATCH a no-op if another request got there first
    transition: (id, from, changes) => patch(`id=eq.${encodeURIComponent(id)}&status=eq.${from}`, changes),
    list: async ({ since }) => (await call(
      `/orders?select=*&status=neq.pending_payment&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=300`,
    )).map(fromRow),
    getSettings: async () => ({ ...DEFAULT_SETTINGS, ...((await call("/settings?key=eq.availability&select=value"))[0]?.value || {}) }),
    setSettings: async (changes) => {
      const current = (await call("/settings?key=eq.availability&select=value"))[0]?.value || {};
      const value = { ...DEFAULT_SETTINGS, ...current, ...changes };
      await call("/settings", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "availability", value }),
      });
      return value;
    },
  };
}
