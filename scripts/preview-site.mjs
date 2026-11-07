import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT) || 4173;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function insideRoot(full) {
  const relative = path.relative(root, full);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRequest(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const rel = pathname.replace(/^\/+/, "");
  const full = path.resolve(root, rel);
  if (!insideRoot(full)) return { error: 403 };
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    if (!pathname.endsWith("/")) return { redirect: `${pathname}/` };
    const index = path.join(full, "index.html");
    return fs.existsSync(index) ? { file: index } : { error: 404 };
  }
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return { file: full };
  return { error: 404 };
}

const server = http.createServer((req, res) => {
  const target = resolveRequest(req.url || "/");
  if (target.redirect) {
    res.writeHead(308, { Location: target.redirect });
    res.end();
    return;
  }
  if (!target.file) {
    res.writeHead(target.error || 404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(target.error === 403 ? "Forbidden" : "Not found");
    return;
  }
  const ext = path.extname(target.file).toLowerCase();
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(target.file).pipe(res);
});

server.listen(port, () => {
  console.log(`Site:   http://localhost:${port}/`);
  console.log(`English: http://localhost:${port}/en/`);
  console.log(`Editor: http://localhost:${port}/build/`);
});
