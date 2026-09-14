// Dependency-free static server for the production build, bound to this PC only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("Build Neurofly first with npm run build.");
  process.exit(1);
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let name = decodeURIComponent(url.pathname);
    if (name === "/") name = "/index.html";
    const file = path.resolve(root, "." + name);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log("Neurofly is ready: http://127.0.0.1:4173/"),
);
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? "Port 4173 is already in use. Neurofly may already be running at http://127.0.0.1:4173/."
      : error.message,
  );
  process.exitCode = 1;
});
