// Sample store used for local development and for the public demo at demo.<base domain>.
import { computeBill } from "@lalcha/domain";
import { createHash } from "node:crypto";
import { listObjects, putObject } from "./storage.ts";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { hashPin } from "./secrets.ts";
import { branches, customerPayments, customers, productPacks, products, saleLines, sales, stockLedger, stores, subscriptions, suppliers, users, coupons, expenses, storeSettings } from "./schema.ts";

/** Staff of the sample stores. The demo PINs are public: they are shown on the demo's sign-in screen. */
export const DEMO_STAFF = {
  demo: [
    ["owner", "Rahim (Owner)", "01711000001", "owner", "4826", "owner@demo.test"],
    ["manager", "Karim (Manager)", "01711000002", "manager", "5072", "manager@demo.test"],
    ["cashier", "Salma (Cashier)", null, "cashier", "3917", null],
  ],
  other: [["owner", "Other Owner", "01711000009", "owner", "6143", "owner@other.test"]],
} as const;

type Shape = "sack" | "bottle" | "box" | "can" | "jar" | "packet" | "tube" | "produce" | "tray";

/** Sample catalogue: generic items with drawn placeholder pictures, until real photos are uploaded. */
export const SEED: [string, string, string, string, number, number, Shape, string][] = [
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
  ["CHINI1", "Chinigura Rice 1kg", "চিনিগুঁড়া চাল ১ কেজি", "staples", 155, 34, "sack", "#F4E3B2"],
  ["MOONG1", "Moong Dal 1kg", "মুগ ডাল ১ কেজি", "staples", 175, 22, "packet", "#B5C99A"],
  ["CHOLA", "Chickpeas 500g", "ছোলা ৫০০ গ্রাম", "staples", 70, 40, "packet", "#D4A373"],
  ["SUJI", "Semolina 500g", "সুজি ৫০০ গ্রাম", "staples", 65, 27, "packet", "#FAEDCD"],
  ["CUMIN", "Cumin Powder 100g", "জিরা গুঁড়া ১০০ গ্রাম", "oil_spice", 120, 18, "jar", "#A47148"],
  ["CORIA", "Coriander Powder 200g", "ধনিয়া গুঁড়া ২০০ গ্রাম", "oil_spice", 85, 24, "jar", "#BC6C25"],
  ["GARAM", "Garam Masala 50g", "গরম মসলা ৫০ গ্রাম", "oil_spice", 70, 31, "box", "#9C6644"],
  ["GHEE", "Ghee 200g", "ঘি ২০০ গ্রাম", "oil_spice", 360, 12, "jar", "#F6BD60"],
  ["COFFEE", "Instant Coffee 50g", "ইনস্ট্যান্ট কফি ৫০ গ্রাম", "drinks", 260, 15, "jar", "#6F4518"],
  ["LEMSODA", "Lemon Soda 250ml", "লেমন সোডা ২৫০ মিলি", "drinks", 35, 48, "can", "#B7E4C7"],
  ["ENERGY", "Energy Drink 250ml", "এনার্জি ড্রিংক ২৫০ মিলি", "drinks", 40, 36, "can", "#F94144"],
  ["CHANA", "Chanachur 250g", "চানাচুর ২৫০ গ্রাম", "snacks", 60, 44, "packet", "#F3722C"],
  ["CREAMB", "Cream Biscuits", "ক্রিম বিস্কুট", "snacks", 30, 70, "packet", "#CDB4DB"],
  ["MURI", "Puffed Rice 500g", "মুড়ি ৫০০ গ্রাম", "snacks", 45, 35, "packet", "#FFF3B0"],
  ["PEANUT", "Peanuts 200g", "চিনাবাদাম ২০০ গ্রাম", "snacks", 55, 29, "packet", "#E6B8A2"],
  ["GARLIC", "Garlic 500g", "রসুন ৫০০ গ্রাম", "fresh", 110, 25, "produce", "#F8EDEB"],
  ["GINGER", "Ginger 250g", "আদা ২৫০ গ্রাম", "fresh", 60, 20, "produce", "#DDB892"],
  ["GCHILI", "Green Chilli 250g", "কাঁচা মরিচ ২৫০ গ্রাম", "fresh", 40, 18, "produce", "#52B788"],
  ["TOMATO", "Tomato 1kg", "টমেটো ১ কেজি", "fresh", 80, 30, "produce", "#E63946"],
  ["DISHBAR", "Dishwash Bar", "ডিশওয়াশ বার", "home_care", 35, 62, "box", "#80ED99"],
  ["FLOOR", "Floor Cleaner 500ml", "ফ্লোর ক্লিনার ৫০০ মিলি", "home_care", 150, 16, "bottle", "#4CC9F0"],
  ["COIL", "Mosquito Coil 10 pcs", "মশার কয়েল ১০টি", "home_care", 75, 40, "box", "#2D6A4F"],
  ["SHAMPOO", "Shampoo 180ml", "শ্যাম্পু ১৮০ মিলি", "personal_care", 220, 23, "bottle", "#B392AC"],
  ["COCOIL", "Coconut Oil 200ml", "নারকেল তেল ২০০ মিলি", "personal_care", 140, 27, "bottle", "#E9F5DB"],
  ["FACEW", "Face Wash 100ml", "ফেসওয়াশ ১০০ মিলি", "personal_care", 180, 14, "tube", "#90E0EF"],
  ["DIAPER", "Baby Diapers M (20)", "বাচ্চার ডায়াপার M (২০টি)", "baby", 650, 11, "packet", "#A2D2FF"],
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

export function artwork(shape: Shape, color: string, label: string) {
  const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const words = escaped.split(" ").slice(0, 2).join(" ");
  const onLabel = shape !== "produce" && shape !== "tray";
  const y = shape === "tube" ? 184 : 232;
  const text = onLabel
    ? `<text x="200" y="${y}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="${words.length > 12 ? 18 : 24}" font-weight="800" fill="#12130F">${words}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${pack(shape, color)}${text}</svg>`;
}

/**
 * Sample pictures go where every product photo goes (R2 when it's set up, a local folder otherwise).
 * Ones already stored are skipped, and a picture that can't be saved never stops the demo from resetting.
 */
async function samplePictures() {
  const stored = new Set((await listObjects("products/").catch(() => [])).map((o) => o.key));
  return {
    async save(file: string, svg: string) {
      if (stored.has(`products/${file}`)) return;
      await putObject(`products/${file}`, Buffer.from(svg), "image/svg+xml").catch((e) => console.error(`sample picture ${file} not saved:`, e instanceof Error ? e.message : e));
    },
  };
}

/** Stable IDs keep seeding repeatable. */
export function stableUuid(input: string) {
  const h = createHash("sha256").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}


type Db = PostgresJsDatabase<Record<string, never>>;
const DAY = 86_400_000;

/** Small repeatable random numbers, so every reset produces the same sample history. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DEMO_CUSTOMERS = [
  ["Jamal Uddin", "জামাল উদ্দিন", "01900000001", 500000],
  ["Nasrin Akter", "নাসরিন আক্তার", "01900000002", 300000],
  ["Habib Store", "হাবিব স্টোর", "01900000003", 1000000],
  ["Rupa Begum", "রুপা বেগম", "01900000004", null],
] as const;

/**
 * Creates a sample store. Phones are left out for the public demo, so nobody can send login codes to real numbers.
 * The demo store also gets two weeks of sales, baki and suppliers, so reports have something to show.
 */
export async function seedStore(db: Db, subdomain: "demo" | "other", name: string, opts: { withPhones: boolean; imageDir: URL }) {
  const storeId = stableUuid(`store:${subdomain}`);
  await db.insert(stores).values({ id: storeId, subdomain, name }).onConflictDoNothing();
  await db.insert(subscriptions).values({ storeId, plan: "growth", trialEndsAt: new Date(Date.now() + 365 * DAY) }).onConflictDoNothing();
  const branchId = stableUuid(`branch:${subdomain}`);
  const [existingBranch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.storeId, storeId)).limit(1);
  if (!existingBranch) await db.insert(branches).values({ storeId, id: branchId, name: "Main" });
  const mainBranch = existingBranch?.id ?? branchId;
  for (const [key, staffName, phone, role, pin, email] of DEMO_STAFF[subdomain]) {
    // The public demo gets no contact details, so no code can ever be sent to a real person.
    await db.insert(users).values({
      storeId, id: stableUuid(`user:${subdomain}:${key}`), name: staffName, phone: opts.withPhones ? phone : null, email: opts.withPhones ? email : null, role, pinHash: await hashPin(pin),
    }).onConflictDoUpdate({ target: [users.storeId, users.id], set: { email: opts.withPhones ? email : null } });
  }
  // Sample stores skip onboarding: a grocery with points and accounts switched on.
  const shop = { businessType: "grocery" as const, features: ["loyalty", "accounting"] as ("loyalty" | "accounting")[], onboarded: true };
  await db.insert(storeSettings).values({ storeId, ...shop }).onConflictDoUpdate({ target: storeSettings.storeId, set: shop });
  if (subdomain === "other") {
    // A second store with one item, so store isolation can be tested.
    await db.insert(products).values({
      storeId, id: stableUuid("other:ITEM"), sku: "ITEM", barcode: null, nameEn: "Other Store Item", nameBn: "অন্য দোকানের পণ্য",
      category: "staples", pricePoisha: 100, costPoisha: 80, imageUrl: null,
    }).onConflictDoNothing();
    return storeId;
  }

  // History is only added to an empty store, so running setup twice doesn't double it.
  const [anySale] = await db.select({ id: sales.id }).from(sales).where(eq(sales.storeId, storeId)).limit(1);
  const history = anySale ? null : sampleHistory(storeId, mainBranch);

  const pictures = await samplePictures();
  let n = 0;
  for (const [sku, nameEn, nameBn, category, price, qty, shape, color] of SEED) {
    n += 1;
    const id = stableUuid(`${subdomain}:${sku}`);
    await pictures.save(`${sku}.svg`, artwork(shape, color, nameEn));
    await db.insert(products).values({
      storeId, id, sku, barcode: `899000000${String(n).padStart(4, "0")}`, nameEn, nameBn, category,
      pricePoisha: price * 100, costPoisha: Math.round(price * 85), imageUrl: `/products/${sku}.svg`,
    }).onConflictDoNothing();
    // Opening stock covers the sample sales, so today's stock still matches the catalogue above.
    await db.insert(stockLedger).values({
      storeId, branchId: mainBranch, id: stableUuid(`opening:${id}`), productId: id, qtyDelta: qty * 1000 + (history?.sold.get(id) ?? 0), reason: "opening",
      occurredAt: new Date(Date.now() - 15 * DAY),
    }).onConflictDoNothing();
  }
  await seedVariantsAndPacks(db, storeId, mainBranch, pictures);
  await db.insert(coupons).values({ storeId, id: stableUuid("demo:coupon:eid"), code: "EID10", kind: "percent", value: 1000, minSpendPoisha: 50_000, maxDiscountPoisha: 20_000 }).onConflictDoNothing();
  if (!history) return storeId;
  const owner = stableUuid(`user:${subdomain}:${DEMO_STAFF[subdomain][0][0]}`);
  const day = (n: number) => new Date(Date.now() + 6 * 3_600_000 - n * DAY).toISOString().slice(0, 10);
  await db.insert(expenses).values([
    { storeId, id: stableUuid("demo:exp:rent"), branchId: mainBranch, category: "rent", amountPoisha: 1_500_000, method: "cash", spentOn: day(10), createdBy: owner },
    { storeId, id: stableUuid("demo:exp:salary"), branchId: mainBranch, category: "salary", amountPoisha: 1_200_000, method: "bkash", ref: "DEMO8XK2", spentOn: day(5), createdBy: owner },
    { storeId, id: stableUuid("demo:exp:bill"), branchId: mainBranch, category: "utilities", amountPoisha: 240_000, method: "cash", note: "বিদ্যুৎ বিল", spentOn: day(3), createdBy: owner },
  ]).onConflictDoNothing();

  await db.insert(suppliers).values([
    { storeId, id: stableUuid("demo:supplier:1"), name: "Meghna Traders", phone: "01900000011", address: "Moulvibazar, Dhaka" },
    { storeId, id: stableUuid("demo:supplier:2"), name: "Fresh Farm Supply", phone: "01900000012", address: "Kawran Bazar, Dhaka" },
  ]);
  await db.insert(customers).values(history.customers);
  for (const s of history.sales) {
    await db.insert(sales).values(s.sale);
    await db.insert(saleLines).values(s.lines);
    await db.insert(stockLedger).values(s.stock);
  }
  await db.insert(customerPayments).values(history.payments);
  return storeId;
}

function sampleHistory(storeId: string, branchId: string) {
  const rnd = random(20260101);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const cashiers = DEMO_STAFF.demo.map(([key]) => stableUuid(`user:demo:${key}`));
  const owner = cashiers[0];
  const catalogue = SEED.map(([sku, nameEn, , , price]) => ({ id: stableUuid(`demo:${sku}`), name: nameEn, price: price * 100, cost: Math.round(price * 85) }));
  const customerRows = DEMO_CUSTOMERS.map(([nameEn, , phone, limit], i) => ({
    storeId, id: stableUuid(`demo:customer:${i}`), name: nameEn, phone, creditLimitPoisha: limit, createdAt: new Date(Date.now() - 20 * DAY),
  }));
  const sold = new Map<string, number>();
  const out: { sale: typeof sales.$inferInsert; lines: (typeof saleLines.$inferInsert)[]; stock: (typeof stockLedger.$inferInsert)[] }[] = [];
  let receipt = 0;

  for (let day = 13; day >= 0; day -= 1) {
    const count = 8 + Math.floor(rnd() * 9);
    for (let k = 0; k < count; k += 1) {
      // Counted back from now, so "today" always has sales whatever time the demo is reset.
      const soldAt = new Date(Date.now() - day * DAY - rnd() * 11 * 3_600_000);
      const chosen = new Map<string, (typeof catalogue)[number]>();
      const lineCount = 1 + Math.floor(rnd() * 4);
      while (chosen.size < lineCount) {
        const p = pick(catalogue);
        chosen.set(p.id, p);
      }
      const lines = [...chosen.values()].map((p) => ({ ...p, qty: (1 + Math.floor(rnd() * 3)) * 1000, unitPricePoisha: p.price, vatRateBp: 0 }));
      const bill = computeBill(lines, 0, true);
      const roll = rnd();
      const method = roll < 0.55 ? "cash" : roll < 0.75 ? "bkash" : roll < 0.85 ? "nagad" : "baki";
      const customer = method === "baki" ? pick(customerRows) : null;
      const id = stableUuid(`demo:sale:${day}:${k}`);
      receipt += 1;
      const cashierId = pick(cashiers);
      out.push({
        sale: {
          storeId, id, cashierId, customerId: customer?.id ?? null, branchId, deviceId: "demo-history", receiptNo: `D-${String(receipt).padStart(4, "0")}`,
          soldAt, syncedAt: soldAt, discountPoisha: 0, totalPoisha: bill.totalPoisha, paymentMethod: method,
          tenderedPoisha: method === "baki" ? 0 : bill.totalPoisha, paymentRef: method === "bkash" || method === "nagad" ? `TX${Math.floor(rnd() * 1e8)}` : null,
          vatInclusive: true, vatPoisha: bill.vatPoisha,
        },
        lines: lines.map((l, i) => ({
          storeId, saleId: id, lineNo: i + 1, productId: l.id, name: l.name, qty: l.qty, unitPricePoisha: l.price, costPoisha: l.cost,
          vatRateBp: 0, vatPoisha: bill.lines[i].vatPoisha, finalPoisha: bill.lines[i].finalPoisha,
        })),
        stock: lines.map((l) => ({ storeId, branchId, productId: l.id, qtyDelta: -l.qty, reason: "sale" as const, refId: id, actorId: cashierId, occurredAt: soldAt })),
      });
      for (const l of lines) sold.set(l.id, (sold.get(l.id) ?? 0) + l.qty);
    }
  }

  // Part of the baki is collected, so customers show a mix of paid and owed amounts.
  const owed = new Map<string, number>();
  for (const { sale } of out) if (sale.customerId) owed.set(sale.customerId, (owed.get(sale.customerId) ?? 0) + Number(sale.totalPoisha));
  const payments = [...owed].map(([customerId, total], i) => ({
    storeId, id: stableUuid(`demo:payment:${i}`), customerId, amountPoisha: Math.floor((total * 0.4) / 100) * 100, method: "cash", paidAt: new Date(Date.now() - 2 * DAY), createdBy: owner,
  })).filter((p) => p.amountPoisha > 0);

  return { sales: out, sold, customers: customerRows, payments };
}

/** Shows the other ways to sell: rope by the foot or by the roll, cola by the can or six-pack, soap in three scents. */
async function seedVariantsAndPacks(db: Db, storeId: string, branchId: string, pictures: Awaited<ReturnType<typeof samplePictures>>) {
  const sku = (k: string) => stableUuid(`demo:${k}`);
  await pictures.save("ROPE.svg", artwork("packet", "#B08968", "Nylon Rope"));
  const extra = [
    { key: "ROPE", nameEn: "Nylon Rope", nameBn: "নাইলন দড়ি", category: "home_care", price: 5, unit: "feet" as const, stock: 500, image: "/products/ROPE.svg", variantOf: null, variantName: null },
    { key: "SOAP-ROSE", nameEn: "Bath Soap", nameBn: "গোসলের সাবান", category: "home_care", price: 70, unit: "pc" as const, stock: 24, image: "/products/SOAP.svg", variantOf: sku("SOAP"), variantName: "গোলাপ" },
    { key: "SOAP-SANDAL", nameEn: "Bath Soap", nameBn: "গোসলের সাবান", category: "home_care", price: 75, unit: "pc" as const, stock: 18, image: "/products/SOAP.svg", variantOf: sku("SOAP"), variantName: "চন্দন" },
  ];
  for (const p of extra) {
    const id = sku(p.key);
    await db.insert(products).values({
      storeId, id, sku: p.key, barcode: null, nameEn: p.nameEn, nameBn: p.nameBn, category: p.category, unit: p.unit,
      pricePoisha: p.price * 100, costPoisha: Math.round(p.price * 85), imageUrl: p.image, variantOf: p.variantOf, variantName: p.variantName,
    }).onConflictDoNothing();
    await db.insert(stockLedger).values({ storeId, branchId, id: stableUuid(`opening:${id}`), productId: id, qtyDelta: p.stock * 1000, reason: "opening", occurredAt: new Date(Date.now() - 15 * DAY) }).onConflictDoNothing();
  }
  await db.update(products).set({ variantName: "লেবু" }).where(and(eq(products.storeId, storeId), eq(products.id, sku("SOAP"))));
  await db.insert(productPacks).values([
    { storeId, id: stableUuid("pack:rope-roll"), productId: sku("ROPE"), name: "রোল ১০০ ফুট", qty: 100_000, pricePoisha: 45_000, barcode: null },
    { storeId, id: stableUuid("pack:cola-6"), productId: sku("COLA"), name: "৬ ক্যান", qty: 6_000, pricePoisha: 29_000, barcode: null },
  ]).onConflictDoNothing();
}
