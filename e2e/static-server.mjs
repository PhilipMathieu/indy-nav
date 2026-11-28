// Minimal static file server for the `out/` export, used by Playwright.
// Usage: node e2e/static-server.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const root = resolve("out");
const port = Number(process.argv[2] ?? process.env.E2E_PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function resolveFile(urlPath) {
  const file = resolve(join(root, decodeURIComponent(urlPath)));
  if (file !== root && !file.startsWith(root + sep)) return null;
  for (const candidate of [file, join(file, "index.html"), `${file}.html`]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

createServer(async (req, res) => {
  const file = await resolveFile(new URL(req.url ?? "/", "http://localhost").pathname);
  if (!file) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}).listen(port, () => console.log(`Serving out/ on http://localhost:${port}`));
