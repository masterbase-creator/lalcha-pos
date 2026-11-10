// Draws the share images and app icons into public/, using Chrome so Bangla is shaped exactly as on
// the website. Run on a computer with Chrome after changing page copy:  node og-render.mjs
// The PNGs are saved with the site, so the server never needs Chrome.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appIconSvg, shareSvg } from "./og.mjs";
import { shareImages } from "./share.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!CHROME) throw new Error("Chrome not found. Set CHROME=/path/to/chrome");

const fontUrl = (pkg, file) => pathToFileURL(join(here, "node_modules", "@fontsource", pkg, "files", file)).href;
const face = (family, pkg, file, weight, range) => `@font-face{font-family:"${family}";font-weight:${weight};src:url("${fontUrl(pkg, file)}") format("woff2");unicode-range:${range}}`;
const BN = "U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1";
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const FONTS = [
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-bengali-700-normal.woff2", 700, BN),
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-bengali-500-normal.woff2", 500, BN),
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-latin-700-normal.woff2", 700, LATIN),
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-latin-500-normal.woff2", 500, LATIN),
  face("Archivo", "archivo", "archivo-latin-900-normal.woff2", 900, LATIN),
  face("Archivo", "archivo", "archivo-latin-700-normal.woff2", 700, LATIN),
].join("");

const work = mkdtempSync(join(tmpdir(), "lalcha-og-"));
function shoot(svg, width, height, out) {
  const page = join(work, "page.html");
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>${FONTS}html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  // The time budget lets the fonts finish loading before the picture is taken.
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${width},${height}`, "--virtual-time-budget=4000", `--screenshot=${out}`, pathToFileURL(page).href], { stdio: "ignore" });
}

const ogDir = join(here, "public", "og");
mkdirSync(ogDir, { recursive: true });
const images = shareImages();
for (const { file, spec } of images) shoot(shareSvg(spec), 1200, 630, join(ogDir, file));
for (const size of [180, 192, 512]) shoot(appIconSvg(size), size, size, join(here, "public", size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`));
rmSync(work, { recursive: true, force: true });
console.log(`Drew ${images.length} share images and 3 app icons.`);
