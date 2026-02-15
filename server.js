import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(join(__dirname, "ui", "dist"));
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".txt": "text/plain",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

createServer(async (req, res) => {
  // Redirect www to non-www
  const host = req.headers.host || "";
  if (host.startsWith("www.")) {
    const location = `https://alienator.org${req.url}`;
    res.writeHead(301, { Location: location });
    return res.end();
  }

  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Path traversal protection — resolve and verify within DIST
  const file = resolve(join(DIST, normalize(urlPath)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end("Forbidden");
  }

  try {
    const data = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      ...SECURITY_HEADERS,
    });
    res.end(data);
  } catch {
    // SPA fallback — serve index.html for all routes
    try {
      const index = await readFile(join(DIST, "index.html"));
      res.writeHead(200, {
        "Content-Type": "text/html",
        ...SECURITY_HEADERS,
      });
      res.end(index);
    } catch {
      res.writeHead(500, SECURITY_HEADERS);
      res.end("Internal Server Error");
    }
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`ALIEN PERC running on port ${PORT}`);
});
