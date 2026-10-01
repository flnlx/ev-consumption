import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { passwordConfig } from "../worker/security.js";
import { bundle } from "./bundle.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}/.wrangler/local`, { recursive: true });
const secret = await readFile(`${root}/.wrangler/local/secret`, "utf8").catch(async () => {
  const value = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  await writeFile(`${root}/.wrangler/local/secret`, value); return value;
});
const mf = new Miniflare({ modules: true, script: await bundle(`${root}/worker/index.js`), compatibilityDate: "2026-08-01",
  kvNamespaces: ["DATA"], durableObjects: { STATE: { className: "Coordinator", useSQLite: true } }, bindings: { SESSION_SECRET: secret },
  kvPersist: `${root}/.wrangler/local/kv`, durableObjectsPersist: `${root}/.wrangler/local/do` });
const kv = await mf.getKVNamespace("DATA");
if (!await kv.get("config:admin")) await kv.put("config:admin", JSON.stringify(await passwordConfig("local-admin-password")));
const namespace = await mf.getDurableObjectNamespace("STATE");
const backend = namespace.get(namespace.idFromName("ev-consumption-v1"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
const server = createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pathname = new URL(req.url, origin).pathname;
  if (pathname.startsWith("/api/")) {
    const buffers = [];
    for await (const buffer of req) buffers.push(buffer);
    const result = await backend.fetch(`${origin}${req.url}`, { method: req.method,
      headers: { ...req.headers, "CF-Connecting-IP": req.socket.remoteAddress },
      ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: Buffer.concat(buffers) }) });
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
  }
  const path = pathname === "/" ? "index.html" : pathname === "/admin" ? "admin.html" : pathname.slice(1);
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.split("/").includes("..") || path.startsWith("_")) { res.writeHead(404); res.end("Not found"); return; }
  const file = await readFile(`${root}/public/${path}`).catch(() => null);
  if (!file) { res.writeHead(404); res.end("Not found"); return; }
  const extension = path.slice(path.lastIndexOf("."));
  res.writeHead(200, { "Content-Type": types[extension] ?? "application/octet-stream", "Cache-Control": "no-store" }); res.end(file);
});
server.listen(Number(process.env.PORT ?? 8788), "127.0.0.1", () => console.log(`本地网页：http://127.0.0.1:${server.address().port}\n管理员：http://127.0.0.1:${server.address().port}/admin.html\n首次本地管理员密码：local-admin-password（仅本地测试，正式部署不会设置此密码）`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { server.close(); await mf.dispose(); process.exit(0); });
