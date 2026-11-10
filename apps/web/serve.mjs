// Local preview of the website. In production a web server or CDN serves dist/ and forwards /v1/public to the API.
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("./dist", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };
const port = Number(process.env.WEB_PORT ?? 4174);

http
  .createServer((req, res) => {
    if (req.url.startsWith("/v1/public/")) {
      const proxy = http.request({ host: "127.0.0.1", port: 8787, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      proxy.on("error", () => { res.writeHead(502); res.end(); });
      req.pipe(proxy);
      return;
    }
    const path = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = join(dist, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": types[".html"] });
      createReadStream(join(dist, "404.html")).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`Website on http://localhost:${port}`));
