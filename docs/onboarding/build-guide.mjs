// Prints the Bangla onboarding guide to PDF with Chrome, which shapes Bangla correctly (most PDF
// libraries break its joined letters). Run from the repo root:  node docs/onboarding/build-guide.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fonts = join(here, "..", "..", "apps", "web", "node_modules", "@fontsource");
const CHROME = process.env.CHROME ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!CHROME) throw new Error("Chrome not found. Set CHROME=/path/to/chrome");

const url = (pkg, file) => pathToFileURL(join(fonts, pkg, "files", file)).href;
const BN = "U+0951-0952,U+0964-0965,U+0980-09FE,U+200C-200D,U+20B9,U+25CC";
const face = (family, pkg, file, weight, range) => `@font-face{font-family:"${family}";font-weight:${weight};src:url("${url(pkg, file)}") format("woff2");${range ? `unicode-range:${range};` : ""}}`;
const FONTS = [
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-bengali-700-normal.woff2", 700, BN),
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-bengali-500-normal.woff2", 500, BN),
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-latin-700-normal.woff2", 700, "U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2190-21FF,U+2212,U+2713,U+2715"),
  face("Hind Siliguri", "hind-siliguri", "hind-siliguri-latin-500-normal.woff2", 500, "U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2190-21FF,U+2212,U+2713,U+2715"),
  face("Lalcha Digits", "hind-siliguri", "hind-siliguri-bengali-700-normal.woff2", "100 900", "U+09E6-09EF"),
  face("Archivo", "archivo", "archivo-latin-900-normal.woff2", 900),
  face("Archivo", "archivo", "archivo-latin-700-normal.woff2", 700),
].join("\n");

/** The tea-glass logo, sized in millimetres. */
let n = 0;
const mark = (mm) => {
  const id = `g${n++}`;
  return `<svg width="${mm}mm" height="${mm}mm" viewBox="0 0 100 100" aria-hidden="true"><defs><clipPath id="${id}"><path d="M22 14h56l-6.6 72.5a6 6 0 0 1-6 5.5H34.6a6 6 0 0 1-6-5.5z"/></clipPath></defs><g clip-path="url(#${id})"><rect x="10" y="14" width="80" height="80" fill="#FFFDF6"/><rect x="10" y="30" width="80" height="64" fill="#B3261E"/><path d="M10 30h80" stroke="#7A140D" stroke-width="3"/><path d="M38 33l2.4 56M50 33v56M62 33l-2.4 56" stroke="#FFFDF6" stroke-opacity=".25" stroke-width="3.5"/></g><path d="M22 14h56l-6.6 72.5a6 6 0 0 1-6 5.5H34.6a6 6 0 0 1-6-5.5z" fill="none" stroke="#12130F" stroke-width="6" stroke-linejoin="round"/></svg>`;
};

/** Ticks, crosses and arrows as tiny drawings in the text colour: no font has to supply them. */
const icon = (d) => `<svg width="0.9em" height="0.9em" viewBox="0 0 16 16" style="vertical-align:-0.1em" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICONS = { CHECK: icon("M2.5 8.5l3.5 3.5 7.5-8"), CROSS: icon("M3.5 3.5l9 9M12.5 3.5l-9 9"), ARROW: icon("M2 8h11M9 4l4 4-4 4") };
const html = readFileSync(join(here, "guide-bn.html"), "utf8")
  .replace("/*FONTS*/", FONTS)
  .replace(/\/\*MARK:(\d+)\*\//g, (_, mm) => mark(Number(mm)))
  .replace(/\/\*(CHECK|CROSS|ARROW)\*\//g, (_, name) => ICONS[name]);
const page = join(here, ".guide-print.html");
writeFileSync(page, html);
const out = join(here, "Lalcha-POS-Onboarding-Guide-BN.pdf");
execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=5000", `--print-to-pdf=${out}`, pathToFileURL(page).href], { stdio: "ignore" });
unlinkSync(page);
// The website offers it for download, so the copy there is kept in step.
copyFileSync(out, join(here, "..", "..", "apps", "web", "public", "guide", "lalcha-pos-guide-bn.pdf"));
console.log(`Saved ${out} and the website copy`);
