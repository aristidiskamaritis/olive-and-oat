// Netlify runs this for every /api/* request; the real work is in server/handler.mjs.
import { handle } from "../../server/handler.mjs";

export default (req) => handle(req, process.env);

export const config = { path: "/api/*" };
