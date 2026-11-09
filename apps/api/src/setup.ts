import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "./config.ts";
import { products, stockLedger, stores, subscriptions, users } from "./schema.ts";
import { hashPin } from "./secrets.ts";

if (config.isProduction) throw new Error("Sample data must never be loaded into production");

/** Development sign-ins only. */
const DEV_STAFF = {
  demo: [
    ["owner", "Rahim (Owner)", "01711000001", "owner", "4826"],
    ["manager", "Karim (Manager)", "01711000002", "manager", "5072"],
    ["cashier", "Salma (Cashier)", null, "cashier", "3917"],
  ],
  other: [["owner", "Other Owner", "01711000009", "owner", "6143"]],
} as const;

type Shape = "sack" | "bottle" | "box" | "can" | "jar" | "packet" | "tube" | "produce" | "tray";

/** Sample catalogue: generic items with drawn placeholder pictures, until real photos are uploaded. */
const SEED: [string, string, string, string, number, number, Shape, string][] = [
  ["RICE5", "Miniket Rice 5kg", "মিনিকেট চাল ৫ কেজি", "staples", 410, 60, "sack", "#E9C46A"],
  ["ATTA2", "Wheat Flour 2kg", "আটা ২ কেজি", "staples", 130, 45, "sack", "#D9A066"],
  ["DAL1", "Red Lentils 1kg", "মসুর ডাল ১ কেজি", "staples", 140, 38, "packet", "#E76F51"],
  ["SUGAR1", "Sugar 1kg", "চিনি ১ কেজি", "staples", 125, 52, "packet", "#8ECAE6"],
  ["SALT1", "Iodized Salt 1kg", "আয়োডিনযুক্ত লবণ ১ কেজি", "staples", 42, 80, "packet", "#4895EF"],
  ["NOODLE", "Masala Noodles 8-pack", "মসলা নুডলস ৮ প্যাক", "staples", 185, 26, "box", "#FFB703"],
  ["SOY1", "Soybean Oil 1L", "সয়াবিন তেল ১ লিটার", "oil_spice", 190, 44, "bottle", "#F4D35E"],
  ["MUST5", "Mustard Oil 500ml", "সরিষার তেল ৫০০ মিলি", "oil_spice", 165, 19, "bottle", "#C98B00"],
  ["TURM", "Turmeric Powder 200g", "হলুদ গুঁড়া ২০০ গ্রাম", "oil_spice", 95, 33, "jar", "#F2A900"],
  ["CHILI", "Chilli Powder 200g", "মরিচ গুঁড়া ২০০ গ্রাম", "oil_spice", 110, 3, "jar", "#D62828"],
  ["TEA200", "Black Tea 200g", "চা পাতা ২০০ গ্রাম", "drinks", 120, 37, "box", "#6A994E"],
  ["WATER1", "Drinking Water 1L", "পানি ১ লিটার", "drinks", 25, 120, "bottle", "#48CAE4"],
  ["COLA", "Cola Can 330ml", "কোলা ক্যান ৩৩০ মিলি", "drinks", 50, 64, "can", "#C1121F"],
  ["MANGO", "Mango Juice 250ml", "আমের জুস ২৫০ মিলি", "drinks", 30, 72, "box", "#FB8500"],
  ["MILK", "Milk Powder 500g", "গুঁড়া দুধ ৫০০ গ্রাম", "drinks", 430, 21, "can", "#F1FAEE"],
  ["BISC", "Butter Biscuits", "বাটার বিস্কুট", "snacks", 40, 90, "packet", "#DDA15E"],
  ["CHIPS", "Potato Chips", "আলুর চিপস", "snacks", 20, 0, "packet", "#FFD60A"],
  ["CAKE", "Sponge Cake", "স্পঞ্জ কেক", "snacks", 15, 54, "packet", "#F28482"],
  ["EGG12", "Eggs 12 pcs", "ডিম ১২ পিস", "fresh", 150, 30, "tray", "#E6CCB2"],
  ["ONION", "Onion 1kg", "পেঁয়াজ ১ কেজি", "fresh", 90, 46, "produce", "#9D4EDD"],
  ["POTATO", "Potato 1kg", "আলু ১ কেজি", "fresh", 35, 75, "produce", "#BC8A5F"],
  ["SOAP", "Bath Soap", "গোসলের সাবান", "home_care", 65, 58, "box", "#FF8FAB"],
  ["DETER", "Detergent Powder 1kg", "ডিটারজেন্ট ১ কেজি", "home_care", 160, 28, "sack", "#4361EE"],
  ["PASTE", "Toothpaste 100g", "টুথপেস্ট ১০০ গ্রাম", "home_care", 95, 4, "tube", "#2EC4B6"],
];

function pack(shape: Shape, c: string) {
  const ink = "#12130F";
  const s = `fill="${c}" stroke="${ink}" stroke-width="7" stroke-linejoin="round"`;
  const band = `fill="#fff" stroke="${ink}" stroke-width="5"`;
  switch (shape) {
    case "sack":
      return `<path d="M95 66 Q200 42 305 66 L330 338 Q200 366 70 338Z" ${s}/><path d="M92 92 Q200 72 308 92" fill="none" stroke="${ink}" stroke-width="6" stroke-dasharray="14 10"/><rect x="104" y="166" width="192" height="104" rx="10" ${band}/>`;
    case "bottle":
      return `<rect x="170" y="36" width="60" height="44" rx="8" fill="${ink}"/><path d="M172 80 h56 q4 44 42 74 v190 q0 22 -22 22 h-96 q-22 0 -22 -22 v-190 q38 -30 42 -74Z" ${s}/><rect x="130" y="196" width="140" height="104" rx="8" ${band}/>`;
    case "box":
      return `<path d="M92 92 L142 56 H336 L308 92Z" fill="#fff" stroke="${ink}" stroke-width="7" stroke-linejoin="round"/><path d="M308 92 L336 56 V312 L308 350Z" fill="${ink}"/><rect x="92" y="92" width="216" height="258" ${s}/><rect x="112" y="170" width="176" height="100" rx="8" ${band}/>`;
    case "can":
      return `<ellipse cx="200" cy="72" rx="90" ry="26" fill="#fff" stroke="${ink}" stroke-width="7"/><path d="M110 72 V330 Q200 382 290 330 V72 Q200 124 110 72Z" ${s}/><rect x="130" y="176" width="140" height="98" rx="8" ${band}/>`;
    case "jar":
      return `<rect x="122" y="48" width="156" height="58" rx="10" fill="${ink}"/><rect x="100" y="106" width="200" height="248" rx="30" ${s}/><rect x="118" y="176" width="164" height="104" rx="8" ${band}/>`;
    case "packet":
      return `<path d="M88 60 h224 l-12 28 l12 244 l-224 0 l12 -244Z" ${s}/><path d="M100 88 H300 M100 332 H300" stroke="${ink}" stroke-width="5"/><rect x="112" y="164" width="176" height="104" rx="8" ${band}/>`;
    case "tube":
      return `<path d="M104 64 H296 L256 310 H144Z" ${s}/><rect x="162" y="310" width="76" height="48" rx="8" fill="${ink}"/><rect x="130" y="130" width="140" height="94" rx="8" ${band}/>`;
    case "produce":
      return `<circle cx="146" cy="244" r="74" ${s}/><circle cx="256" cy="244" r="74" ${s}/><circle cx="200" cy="146" r="78" ${s}/><path d="M200 70 q-6 -24 18 -38" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round"/>`;
    case "tray": {
      const eggs = [116, 200, 284]
        .flatMap((x) => [140, 244].map((y) => `<ellipse cx="${x}" cy="${y}" rx="36" ry="46" fill="#fff" stroke="${ink}" stroke-width="6"/>`))
        .join("");
      return `<rect x="56" y="76" width="288" height="240" rx="26" ${s}/>${eggs}`;
    }
  }
}

function artwork(shape: Shape, color: string, label: string) {
  const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const words = escaped.split(" ").slice(0, 2).join(" ");
  const onLabel = shape !== "produce" && shape !== "tray";
  const y = shape === "tube" ? 184 : 232;
  const text = onLabel
    ? `<text x="200" y="${y}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="${words.length > 12 ? 18 : 24}" font-weight="800" fill="#12130F">${words}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${pack(shape, color)}${text}</svg>`;
}

/** Stable IDs keep seeding repeatable. */
function stableUuid(input: string) {
  const h = createHash("sha256").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const client = postgres(config.adminDatabaseUrl, { max: 1, onnotice: () => {} });
const db = drizzle(client);

await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await client.unsafe(readFileSync(new URL("./rls.sql", import.meta.url), "utf8"));

const imageDir = new URL("../public/products/", import.meta.url);
mkdirSync(imageDir, { recursive: true });

for (const [subdomain, name] of [["demo", "Demo Super Shop"], ["other", "Other Store"]] as const) {
  const storeId = stableUuid(`store:${subdomain}`);
  await db.insert(stores).values({ id: storeId, subdomain, name }).onConflictDoNothing();
  await db.insert(subscriptions).values({ storeId, plan: "pro", trialEndsAt: new Date(Date.now() + 365 * 86_400_000) }).onConflictDoNothing();
  for (const [key, staffName, phone, role, pin] of DEV_STAFF[subdomain]) {
    await db.insert(users).values({
      storeId, id: stableUuid(`user:${subdomain}:${key}`), name: staffName, phone, role, pinHash: await hashPin(pin),
    }).onConflictDoNothing();
  }
  if (subdomain === "other") {
    // A second store with one item, so store isolation can be tested.
    const id = stableUuid("other:ITEM");
    await db.insert(products).values({
      storeId, id, sku: "ITEM", barcode: null, nameEn: "Other Store Item", nameBn: "অন্য দোকানের পণ্য",
      category: "staples", pricePoisha: 100, costPoisha: 80, imageUrl: null,
    }).onConflictDoNothing();
    continue;
  }
  let n = 0;
  for (const [sku, nameEn, nameBn, category, price, qty, shape, color] of SEED) {
    n += 1;
    const id = stableUuid(`${subdomain}:${sku}`);
    writeFileSync(new URL(`${sku}.svg`, imageDir), artwork(shape, color, nameEn));
    await db.insert(products).values({
      storeId, id, sku, barcode: `899000000${String(n).padStart(4, "0")}`, nameEn, nameBn, category,
      pricePoisha: price * 100, costPoisha: Math.round(price * 85), imageUrl: `/products/${sku}.svg`,
    }).onConflictDoNothing();
    await db.insert(stockLedger).values({
      storeId, id: stableUuid(`opening:${id}`), productId: id, qtyDelta: qty, reason: "opening",
    }).onConflictDoNothing();
  }
}

await client.end();
console.log("Database ready: migrations, access rules and sample data applied.");
