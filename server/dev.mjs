/* =========================================================
   Local server for trying the site with ordering on your own computer.
     node server/dev.mjs        → http://localhost:8888
   Serves the site files and sends /api/* to the ordering code, the same
   way Netlify does once it's live. Settings come from the .env file.
   ========================================================= */
import http from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

// .env → process.env (lines like KEY=value; # starts a comment)
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const { handle } = await import("./handler.mjs");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".ico": "image/x-icon", ".mp4": "video/mp4", ".txt": "text/plain", ".xml": "application/xml",
};
// never served: server code, saved orders, secrets and notes
const PRIVATE = /^\/(server|netlify|data|node_modules)(\/|$)|\/\.|\.(md|sql)$/i;

async function api(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handle(request, process.env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
  console.log(`${req.method} ${req.url.split("?")[0]} → ${response.status}`);
}

function file(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (PRIVATE.test(path)) return notFound(res);
  let full = join(root, normalize(path));
  if (!full.startsWith(root)) return notFound(res);
  if (existsSync(full) && statSync(full).isDirectory()) {
    if (!path.endsWith("/")) { res.writeHead(301, { location: path + "/" }); return res.end(); }
    full = join(full, "index.html");
  }
  if (!existsSync(full)) return notFound(res);

  const size = statSync(full).size;
  const headers = { "content-type": TYPES[extname(full).toLowerCase()] || "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-cache" };
  // byte ranges let the background film seek while scrolling
  const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? +range[1] : size - +range[2];
    const end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return createReadStream(full, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": size });
  createReadStream(full).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

const port = Number(process.env.PORT) || 8888;
http.createServer((req, res) => {
  const run = req.url.startsWith("/api/") ? api(req, res) : Promise.resolve(file(req, res));
  run.catch((err) => { console.error(err); if (!res.headersSent) res.writeHead(500); res.end("Server error"); });
}).listen(port, "127.0.0.1", () => {
  const payments = process.env.STRIPE_SECRET_KEY ? "Stripe" : process.env.DEMO_PAYMENTS === "true" ? "simulated (demo)" : "off";
  console.log(`\n  Olive & Oat with online ordering`);
  console.log(`  Site:   http://localhost:${port}/`);
  console.log(`  Admin:  http://localhost:${port}/admin/`);
  console.log(`  Card payments: ${payments} · Orders saved in: ${process.env.SUPABASE_URL ? "Supabase" : "data/orders.json"}\n`);
});
