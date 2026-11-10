// Share images: when a lalcha.com link is pasted into Facebook, WhatsApp, Messenger, LinkedIn or X,
// they show a 1200×630 picture. Those apps don't accept SVG, so each page gets its own PNG. The
// drawings are made here; og-render.mjs turns them into PNGs with Chrome, which shapes Bangla exactly
// as the website does.
import { shopIconInner } from "./icons.mjs";

const INK = "#12130F";
const CREAM = "#F7F4EA";
const PANEL = "#FFFDF6";
const LIME = "#D7FF3F";
const MUTED = "#5D5C50";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tea-glass mark, placed at (x, y) and scaled from its 100-unit drawing. */
export function glass(x, y, size, id = "g") {
  return `<g transform="translate(${x} ${y}) scale(${size / 100})">
    <defs><clipPath id="${id}"><path d="M22 14h56l-6.6 72.5a6 6 0 0 1-6 5.5H34.6a6 6 0 0 1-6-5.5z"/></clipPath></defs>
    <g clip-path="url(#${id})"><rect x="10" y="14" width="80" height="80" fill="${PANEL}"/><rect x="10" y="30" width="80" height="64" fill="#B3261E"/>
    <path d="M10 30h80" stroke="#7A140D" stroke-width="3"/><path d="M38 33l2.4 56M50 33v56M62 33l-2.4 56" stroke="${PANEL}" stroke-opacity=".25" stroke-width="3.5"/></g>
    <path d="M22 14h56l-6.6 72.5a6 6 0 0 1-6 5.5H34.6a6 6 0 0 1-6-5.5z" fill="none" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
  </g>`;
}

/**
 * Breaks text into lines that fit, by an estimate of glyph width (Bangla runs a little narrower per
 * character than its letter count suggests, Latin a little wider). Overflow ends with an ellipsis.
 */
function wrap(text, fontSize, maxWidth, maxLines, bangla) {
  const perChar = fontSize * (bangla ? 0.5 : 0.5);
  const limit = Math.max(8, Math.floor(maxWidth / perChar));
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if ([...next].length > limit && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[,;:।.]?\s*\S*$/, "")}…`;
  }
  return lines;
}

const tspans = (lines, x, y, lineHeight) => lines.map((l, i) => `<tspan x="${x}" y="${y + i * lineHeight}">${esc(l)}</tspan>`).join("");

/**
 * One share image. `art` is the right-hand picture: a shop type's icon, or the big tea glass for
 * general pages. `chips` are short facts along the bottom.
 */
export function shareSvg({ lang, eyebrow, title, subtitle, shopType, chips }) {
  const bn = lang === "bn";
  const body = "Hind Siliguri";
  const titleSize = bn ? 62 : 58;
  const titleLines = wrap(title, titleSize, 690, 3, bn);
  const subLines = wrap(subtitle, 28, 690, 2, bn);
  const titleY = 246;
  const subY = titleY + (titleLines.length - 1) * (titleSize * 1.12) + 58;

  let x = 76;
  const chipSvg = chips
    .map((c, i) => {
      const w = Math.round([...c].length * (bn ? 13.5 : 13) + 44);
      const out = `<g transform="translate(${x} 516)"><rect width="${w}" height="50" rx="25" fill="${i === 0 ? LIME : PANEL}" stroke="${INK}" stroke-width="3.5"/><text x="${w / 2}" y="33" text-anchor="middle" font-family="${body}" font-weight="700" font-size="24" fill="${INK}">${esc(c)}</text></g>`;
      x += w + 14;
      return out;
    })
    .join("");

  const art = shopType
    ? `<g transform="translate(838 150)"><rect x="14" y="14" width="300" height="300" rx="56" fill="${INK}"/><rect width="300" height="300" rx="56" fill="${PANEL}" stroke="${INK}" stroke-width="8"/>
       <g transform="translate(46 46) scale(6.5)" color="${INK}">${shopIconInner(shopType).replaceAll("var(--accent)", LIME).replaceAll("currentColor", INK)}</g></g>`
    : `<g transform="translate(822 120)">
       <path d="M110 40c-14-12 14-20 0-36M168 40c-14-12 14-20 0-36M226 40c-14-12 14-20 0-36" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
       ${glass(20, 52, 320, "big")}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${CREAM}"/>
  <rect x="34" y="34" width="1144" height="574" fill="${INK}"/>
  <rect x="22" y="22" width="1144" height="574" fill="${PANEL}" stroke="${INK}" stroke-width="8"/>
  <rect x="22" y="22" width="1144" height="14" fill="${LIME}"/>
  ${glass(66, 62, 64, "mark")}
  <text x="140" y="112" font-family="Archivo" font-weight="900" font-size="44" letter-spacing="-1" fill="${INK}">Lalcha</text>
  <g transform="translate(318 76)"><rect width="78" height="42" rx="8" fill="${LIME}" stroke="${INK}" stroke-width="3.5"/><text x="39" y="30" text-anchor="middle" font-family="Archivo" font-weight="900" font-size="22" fill="${INK}">POS</text></g>
  <text x="1124" y="108" text-anchor="end" font-family="Archivo" font-weight="700" font-size="26" fill="${MUTED}">lalcha.com</text>
  ${eyebrow ? `<text x="78" y="${titleY - 72}" font-family="${body}" font-weight="700" font-size="28" fill="#B3261E">${esc(eyebrow)}</text>` : ""}
  <text font-family="${body}" font-weight="700" font-size="${titleSize}" fill="${INK}">${tspans(titleLines, 76, titleY, titleSize * 1.12)}</text>
  <text font-family="${body}" font-weight="500" font-size="28" fill="${MUTED}">${tspans(subLines, 78, subY, 38)}</text>
  ${chipSvg}
  ${art}
</svg>`;
}

/** The square app icon on cream, for iPhone home screens and Android, which don't take SVG. */
export function appIconSvg(size) {
  const pad = size * 0.14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${PANEL}"/>${glass(pad, pad, size - pad * 2, "app")}</svg>`;
}
