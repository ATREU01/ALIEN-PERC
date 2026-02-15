import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(__dirname, "ui", "dist");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  let path = req.url.split("?")[0];
  if (path === "/") path = "/index.html";

  try {
    const file = join(DIST, path);
    const data = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback — serve index.html for all routes
    const index = await readFile(join(DIST, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(index);
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`ALIEN PERC running on port ${PORT}`);
});
