// Writes the service worker after each build, listing every built file so the POS can load with no internet.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile())
  .map((f) => join(f.parentPath, f.name))
  .filter((f) => !f.endsWith("sw.js"));

const template = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8");
const hash = createHash("sha256");
hash.update(template);
for (const f of files) hash.update(readFileSync(f));
const version = hash.digest("hex").slice(0, 12);

const urls = files.map((f) => "/" + relative(dist, f).split("\\").join("/")).map((u) => (u === "/index.html" ? "/" : u));
writeFileSync(join(dist, "sw.js"), template.replace("__VERSION__", version).replace('"__URLS__"', JSON.stringify(urls)));
console.log(`Service worker ${version}: ${urls.length} files`);
