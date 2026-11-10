// Builds the public website as plain HTML, so search engines can read every page and it loads fast on mobile data.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHOPS as ALL_SHOPS } from "./shops.mjs";
import { shopIcon } from "./icons.mjs";

/** Same order as onboarding in the app; "Any retail shop" always last. */
const ORDER = ["grocery", "general_store", "pharmacy", "restaurant", "tea_stall", "hardware", "furniture", "electronics", "auto_parts", "fashion", "jewellery", "cosmetics", "optical", "stationery", "bakery", "agro", "wholesale", "general"];
const SHOPS = [...ALL_SHOPS].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
/** Two of a shop's own features, so each card says something the title doesn't. */
const teaser = (x, lang) => x[lang].features.slice(0, 2).map(([h]) => h).join(" · ");

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const SITE = "https://lalcha.com";
const REPO = "https://github.com/masterbase-creator/lalcha-pos";
const CONTACT = "hello@lalcha.com";
/** The public demo store. Local preview overrides it, see the root package.json. */
const DEMO_URL = process.env.DEMO_URL ?? "https://demo.lalcha.com/";
/** Shown above the demo frame. Always the public address, even in a local preview. */
const DEMO_LABEL = "demo.lalcha.com";
/**
 * Files get their content's fingerprint in the address (style.css?v=…), so a changed stylesheet or
 * logo reaches visitors at once instead of after Cloudflare's and the browser's caches expire.
 */
const v = (file) => `/${file}?v=${createHash("sha256").update(readFileSync(join(here, "public", file))).digest("hex").slice(0, 10)}`;
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, "public"), dist, { recursive: true });

const ui = {
  en: {
    prefix: "/en", other: "/", otherLabel: "বাংলা", locale: "en_US",
    demo: "Demo", menu: "Menu", shopTypes: "For your shop", contact: "Contact", features: "Features", pricing: "Pricing", openSource: "Open source", signIn: "Sign in", start: "Start free", privacy: "Privacy", terms: "Terms",
    rights: "Lalcha POS. Open source software for shops in Bangladesh.",
  },
  bn: {
    prefix: "", other: "/en/", otherLabel: "English", locale: "bn_BD",
    demo: "ডেমো", menu: "মেনু", shopTypes: "দোকান অনুযায়ী", contact: "যোগাযোগ", features: "সুবিধা", pricing: "মূল্য", openSource: "ওপেন সোর্স", signIn: "সাইন ইন", start: "ফ্রি শুরু করুন", privacy: "প্রাইভেসি", terms: "শর্তাবলি",
    rights: "Lalcha POS। বাংলাদেশের দোকানের জন্য ওপেন সোর্স সফটওয়্যার।",
  },
};

const ORG = { "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#org`, name: "Lalcha POS", url: SITE, logo: `${SITE}/logo.svg`, email: CONTACT, sameAs: [REPO], areaServed: "BD" };
const crumbs = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE}${url}` })) });
/** Every indexable page, with its Bangla and English addresses, for the sitemap. */
const pages = [];

function page({ lang, path, title, description, body, alt = true, schema = [], noindex = false }) {
  if (!noindex && !pages.some((p) => p.path === path && p.alt === alt && (alt || p.lang === lang))) pages.push({ path, alt, lang });
  const u = ui[lang];
  const canonical = `${SITE}${alt ? u.prefix : ""}${path}`;
  const links = alt
    ? `<link rel="alternate" hreflang="bn" href="${SITE}${path}"><link rel="alternate" hreflang="en" href="${SITE}/en${path}"><link rel="alternate" hreflang="x-default" href="${SITE}${path}">`
    : "";
  const otherHref = alt ? (lang === "bn" ? `/en${path}` : path) : u.other;
  const currentIf = (href) => (href === `${u.prefix}${path}` ? ' aria-current="page"' : "");
  const navLinks = [[`${u.prefix}/#live`, u.demo], [`${u.prefix}/for/`, u.shopTypes], [`${u.prefix}/#features`, u.features], [`${u.prefix}/#pricing`, u.pricing], [`${u.prefix}/contact/`, u.contact]]
    .map(([href, label]) => `<a href="${href}"${currentIf(href)}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${canonical}">
${links}
<meta name="theme-color" content="#fffdf6">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lalcha POS">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="${u.locale}">
<meta property="og:image" content="${SITE}/icon.svg">
<meta name="apple-mobile-web-app-title" content="Lalcha POS">
<meta name="twitter:card" content="summary">
<link rel="icon" href="${v("icon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${v("style.css")}">
${[ORG, ...schema].map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join("\n")}
</head>
<body>
<header class="site"><div class="wrap bar">
<a class="logo" href="${u.prefix}/" aria-label="Lalcha POS"><img src="${v("icon.svg")}" alt="" width="40" height="40"><span class="logo-word">Lalcha<span class="logo-pos">POS</span></span></a>
<nav class="top" aria-label="Main">${navLinks}</nav>
<div class="actions"><a class="lang" href="${otherHref}" hreflang="${lang === "bn" ? "en" : "bn"}" lang="${lang === "bn" ? "en" : "bn"}">${lang === "bn" ? "EN" : "বাং"}</a><a class="signin" href="${u.prefix}/login/">${u.signIn}</a><a class="btn small" href="${u.prefix}/signup/">${u.start}</a></div>
<details class="menu"><summary aria-label="${u.menu}"><span aria-hidden="true"></span></summary><nav aria-label="${u.menu}">${navLinks}<a href="${u.prefix}/login/">${u.signIn}</a><a href="${otherHref}">${u.otherLabel}</a><a class="menu-cta" href="${u.prefix}/signup/">${u.start}</a></nav></details>
</div></header>
${body}
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${u.rights}</span>
<nav aria-label="Footer">${SHOPS.map((x) => `<a href="${u.prefix}/for/${x.slug}/">${x[lang].name}</a>`).join("")}<a href="/open-source/">${u.openSource}</a><a href="/terms/">${u.terms}</a><a href="/privacy/">${u.privacy}</a><a href="${u.prefix}/contact/">${u.contact}</a><a href="${REPO}">GitHub</a><a href="mailto:${CONTACT}">${CONTACT}</a></nav>
</div></footer>
</body></html>
`;
}

function write(path, html) {
  const dir = join(dist, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

const plans = [["Starter", "৳499", 2, 1], ["Growth", "৳999", 5, 3]];

const home = {
  en: {
    title: "Lalcha POS: The Easiest POS Software for Shops in Bangladesh",
    description: "The easiest POS for Bangladesh shops. Tap a product photo to bill, and track stock, baki, purchases and VAT in Bangla or English. Try Lalcha POS free for 14 days.",
    h1: "The easiest way to run your shop.",
    lead: "Tap a product photo and the bill is done. Sales, stock, baki, purchases and VAT in one place, in Bangla or English.",
    trial: "14 days free. No payment needed to start.",
    seeDemo: "See the demo", liveNote: "<b>Tap anything.</b> This is the real app with a sample shop, not a screenshot.", newTab: "Open full screen ↗",
    featuresTitle: "Everything a shop runs on",
    list: [
      ["Works without internet", "Keep billing, giving baki and taking returns during an outage. Everything uploads by itself when the connection returns."],
      ["Baki that adds up", "Customer credit with limits, part-payments and a clear history of what each person owes."],
      ["Stock you can trust", "Live stock from sales, purchases and returns, with average cost and low stock alerts."],
      ["Loose goods and scales", "Sell by kg, litre or metre, by weight or by taka amount. Read barcodes printed by weighing scales."],
      ["Purchases and suppliers", "Orders, partial deliveries, supplier dues, advances, purchase returns and voids."],
      ["Mushak 6.3 VAT details", "Set your own VAT rates, per product if needed, with VAT details on each invoice."],
      ["Multiple branches", "Separate stock per branch, stock transfers, and reports for one branch or all of them."],
      ["Staff under control", "Owner, manager and cashier roles, PIN sign-in, shift cash counts and a full activity log."],
      ["Profit reports", "Sales, profit, payments and top products, exportable to Excel and PDF."],
      ["Batches and expiry dates", "For pharmacies and cosmetics: batch numbers, expiry alerts, and the earliest batch sold first."],
      ["IMEI and warranty", "For mobile and electronics shops: a serial per piece on purchase and sale, and warranty lookup."],
      ["Tables and kitchen tickets", "For restaurants: open orders by table, kitchen tickets and extras like extra cheese."],
      ["Points, coupons, gift cards", "Bring regular customers back with points, Eid coupons and gift cards."],
      ["Expenses and real profit", "Rent, salaries and bills, a cash book, profit after expenses, and an export for Excel or Tally."],
      ["Thermal printer and cash drawer", "Print receipts straight to a USB thermal printer, in Bangla, and pop the cash drawer."],
    ],
    shopsTitle: "Made for your kind of shop", shopsLead: "Pick your shop type when you start, and Lalcha POS switches on what that kind of shop needs.",
    pricingTitle: "Simple monthly pricing",
    month: "per month", devices: "devices", branches: "branches", choose: "Start free",
    enterprise: "Enterprise", custom: "Custom", enterpriseText: "For chains, many branches or special needs. We build a solution around your business.", talk: "Contact us",
    faqTitle: "Common questions",
    faq: [
      ["Does Lalcha POS work without internet?", "Yes. Sales, baki, collections, returns and basic reports keep working on the device and upload automatically when the internet returns."],
      ["Can I use bKash and Nagad?", "Yes. You can record bKash, Nagad, card and cash payments at the till with the transaction ID. Automatic online payment collection is planned."],
      ["Does it work in Bangla?", "Yes. The whole till works in Bangla and English, including Bangla product names and digits."],
      ["Can I sell rice, oil and other loose goods?", "Yes. Sell by kg, litre or metre, enter the quantity or a taka amount, or scan a label from a weighing scale."],
      ["Is Lalcha POS open source?", "Yes. The source code is public under the AGPL-3.0 license, so you can inspect it or host it yourself."],
    ],
  },
  bn: {
    title: "Lalcha POS: দোকানের সবচেয়ে সহজ POS সফটওয়্যার, ১৪ দিন ফ্রি",
    description: "দোকানের সবচেয়ে সহজ সফটওয়্যার। পণ্যের ছবিতে ট্যাপ করলেই বিল। বিক্রি, স্টক, বাকি খাতা, ক্রয় ও ভ্যাটের হিসাব বাংলায়। Lalcha POS ১৪ দিন ফ্রি ব্যবহার করুন।",
    h1: "দোকান চালানোর সবচেয়ে সহজ উপায়।",
    lead: "পণ্যের ছবিতে ট্যাপ করুন, বিল তৈরি। বিক্রি, স্টক, বাকি খাতা, ক্রয় ও ভ্যাট, সব এক জায়গায়, বাংলায়।",
    trial: "১৪ দিন ফ্রি। শুরু করতে কোনো পেমেন্ট লাগবে না।",
    seeDemo: "ডেমো দেখুন", liveNote: "<b>যেকোনো জায়গায় ট্যাপ করুন।</b> এটা আসল অ্যাপ, একটি নমুনা দোকানসহ। স্ক্রিনশট নয়।", newTab: "ফুল স্ক্রিনে খুলুন ↗",
    featuresTitle: "দোকান চালাতে যা যা দরকার",
    list: [
      ["ইন্টারনেট ছাড়াই কাজ করে", "ইন্টারনেট না থাকলেও বিল, বাকি ও ফেরত চলবে। সংযোগ ফিরলে সব নিজে থেকেই আপলোড হবে।"],
      ["সঠিক বাকি খাতা", "ক্রেতার বাকির সীমা, আংশিক পরিশোধ এবং কার কত বাকি তার পরিষ্কার হিসাব।"],
      ["নির্ভুল স্টক", "বিক্রি, ক্রয় ও ফেরত থেকে সরাসরি স্টকের হিসাব, গড় ক্রয়মূল্য ও কম স্টকের তালিকা।"],
      ["খোলা পণ্য ও ওজন মেশিন", "কেজি, লিটার বা মিটারে, ওজন বা টাকার পরিমাণে বিক্রি করুন। ওজন মেশিনের বারকোডও পড়ে।"],
      ["ক্রয় ও সরবরাহকারী", "অর্ডার, আংশিক ডেলিভারি, সরবরাহকারীর পাওনা, অগ্রিম, ফেরত ও বাতিল।"],
      ["মূসক ৬.৩ ভ্যাট তথ্য", "নিজের ভ্যাটের হার ঠিক করুন, প্রয়োজনে পণ্য অনুযায়ী। প্রতিটি চালানে ভ্যাটের তথ্য থাকবে।"],
      ["একাধিক শাখা", "শাখা অনুযায়ী আলাদা স্টক, স্টক স্থানান্তর এবং এক বা সব শাখার রিপোর্ট।"],
      ["কর্মীদের নিয়ন্ত্রণ", "মালিক, ম্যানেজার ও ক্যাশিয়ার ভূমিকা, পিন সাইন-ইন, শিফটের ক্যাশ গণনা ও কার্যক্রমের হিসাব।"],
      ["লাভের রিপোর্ট", "বিক্রি, লাভ, পেমেন্ট ও সেরা পণ্যের রিপোর্ট। Excel ও PDF-এ নামানো যায়।"],
      ["ব্যাচ ও মেয়াদ", "ফার্মেসি আর কসমেটিকসের জন্য: ব্যাচ নম্বর, মেয়াদের সতর্কতা, আগের মেয়াদ আগে বিক্রি।"],
      ["আইএমইআই ও ওয়ারেন্টি", "মোবাইল ও ইলেকট্রনিক্সের জন্য: কেনা-বেচায় প্রতিটির সিরিয়াল, পরে ওয়ারেন্টি যাচাই।"],
      ["টেবিল ও কিচেন টিকিট", "রেস্টুরেন্টের জন্য: টেবিল ধরে অর্ডার, কিচেন টিকিট আর বাড়তি চিজের মতো অপশন।"],
      ["পয়েন্ট, কুপন, গিফট কার্ড", "পয়েন্ট, ঈদের কুপন আর গিফট কার্ড দিয়ে নিয়মিত ক্রেতাদের ফিরিয়ে আনুন।"],
      ["খরচ ও আসল লাভ", "ভাড়া, বেতন, বিল, ক্যাশবুক, খরচ বাদে লাভ, আর এক্সেল বা ট্যালির জন্য নামানো।"],
      ["থার্মাল প্রিন্টার ও ক্যাশ ড্রয়ার", "বাংলায় রসিদ সরাসরি ইউএসবি থার্মাল প্রিন্টারে, সাথে ক্যাশ ড্রয়ারও খোলে।"],
    ],
    shopsTitle: "আপনার দোকানের মতো করে বানানো", shopsLead: "শুরুতে দোকানের ধরন বেছে নিন, Lalcha POS সেই দোকানে যা লাগে তা চালু করে দেবে।",
    pricingTitle: "সহজ মাসিক মূল্য",
    month: "প্রতি মাস", devices: "ডিভাইস", branches: "শাখা", choose: "ফ্রি শুরু করুন",
    enterprise: "Enterprise", custom: "কাস্টম", enterpriseText: "চেইন শপ, অনেক শাখা বা বিশেষ প্রয়োজনের জন্য। আপনার ব্যবসা অনুযায়ী সমাধান তৈরি করে দেব।", talk: "যোগাযোগ করুন",
    faqTitle: "সাধারণ প্রশ্ন",
    faq: [
      ["ইন্টারনেট ছাড়া Lalcha POS চলবে?", "হ্যাঁ। বিক্রি, বাকি, আদায়, ফেরত ও সাধারণ রিপোর্ট ডিভাইসেই চলবে এবং ইন্টারনেট ফিরলে নিজে থেকে আপলোড হবে।"],
      ["বিকাশ ও নগদ ব্যবহার করা যাবে?", "হ্যাঁ। কাউন্টারে বিকাশ, নগদ, কার্ড ও ক্যাশ পেমেন্ট ট্রানজেকশন আইডিসহ লিখে রাখা যায়। স্বয়ংক্রিয় অনলাইন পেমেন্ট পরে আসবে।"],
      ["বাংলায় চলে?", "হ্যাঁ। পুরো কাউন্টার বাংলা ও ইংরেজিতে চলে, বাংলা পণ্যের নাম ও সংখ্যাসহ।"],
      ["চাল, তেলের মতো খোলা পণ্য বিক্রি করা যাবে?", "হ্যাঁ। কেজি, লিটার বা মিটারে বিক্রি করুন, পরিমাণ বা টাকা লিখুন, অথবা ওজন মেশিনের লেবেল স্ক্যান করুন।"],
      ["Lalcha POS কি ওপেন সোর্স?", "হ্যাঁ। সোর্স কোড AGPL-3.0 লাইসেন্সে উন্মুক্ত, তাই আপনি দেখতে বা নিজে হোস্ট করতে পারবেন।"],
    ],
  },
};

for (const lang of ["bn", "en"]) {
  const c = home[lang];
  const u = ui[lang];
  const body = `<main>
<section class="hero"><div class="wrap">
<h1>${c.h1}</h1><p class="lead">${c.lead}</p>
<div class="cta"><a class="btn" href="${u.prefix}/signup/">${u.start}</a><a class="btn alt" href="#live">${c.seeDemo}</a></div>
<p class="note">${c.trial}</p>
</div></section>
<section class="live-band" id="live"><div class="wrap">
<div class="live-note"><span class="live-dot" aria-hidden="true"></span><p>${c.liveNote}</p><a href="${DEMO_URL}" target="_blank" rel="noopener">${c.newTab}</a></div>
<div class="live">
<div class="live-bar"><span class="live-dots" aria-hidden="true"></span><span class="live-host">${DEMO_LABEL}</span></div>
<iframe src="${DEMO_URL}" title="Lalcha POS" loading="lazy"></iframe>
</div>
</div></section>
<section class="band alt" id="features"><div class="wrap"><h2>${c.featuresTitle}</h2><div class="grid">${c.list.map(([h, p]) => `<article class="card"><h3>${h}</h3><p>${p}</p></article>`).join("")}</div></div></section>
<section class="band" id="shops"><div class="wrap"><h2>${c.shopsTitle}</h2><p class="lead">${c.shopsLead}</p><div class="grid shops">${SHOPS.map((x) => `<a class="card shop" href="${u.prefix}/for/${x.slug}/"><span class="shop-icon">${shopIcon(x.type)}</span><h3>${x[lang].name}</h3><p>${teaser(x, lang)}</p></a>`).join("")}</div></div></section>
<section class="band" id="pricing"><div class="wrap"><h2>${c.pricingTitle}</h2><div class="grid">${plans.map(([n, p, d, b]) => `<article class="card"><h3>${n}</h3><div class="price">${p}</div><p>${c.month} · ${d} ${c.devices} · ${b} ${c.branches}</p><p style="margin-top:14px"><a class="btn small" href="${u.prefix}/signup/">${c.choose}</a></p></article>`).join("")}<article class="card"><h3>${c.enterprise}</h3><div class="price">${c.custom}</div><p>${c.enterpriseText}</p><p style="margin-top:14px"><a class="btn small alt" href="${u.prefix}/contact/?topic=enterprise">${c.talk}</a></p></article></div></div></section>
<section class="band alt"><div class="wrap"><h2>${c.faqTitle}</h2>${c.faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}</div></section>
</main>`;
  const schema = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Lalcha POS", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: SITE, description: c.description, inLanguage: ["bn", "en"], license: "https://www.gnu.org/licenses/agpl-3.0.html", offers: { "@type": "Offer", price: "499", priceCurrency: "BDT" } },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: c.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  write(lang === "en" ? "en" : "", page({ lang, path: "/", title: c.title, description: c.description, body, schema }));

  const s = lang === "bn"
    ? { suggest: "এগুলো খালি আছে, ট্যাপ করে নিন:", title: "আপনার দোকান খুলুন", intro: "১৪ দিন ফ্রি। শুরু করতে কোনো পেমেন্ট লাগবে না।", store: "দোকানের নাম", address: "দোকানের ওয়েব ঠিকানা", owner: "আপনার নাম", email: "ইমেইল", emailHint: "লগইন কোড এখানে আসবে।", phone: "মোবাইল নম্বর (ঐচ্ছিক)", pin: "পিন (৪–৬ সংখ্যা)", code: "৬ সংখ্যার কোড", send: "কোড পাঠান", create: "দোকান তৈরি করুন", free: "এই ঠিকানা পাওয়া যাচ্ছে", agree: "চালিয়ে গেলে আপনি শর্তাবলি ও প্রাইভেসি নীতিতে সম্মত হচ্ছেন।", have: "দোকান আছে? সাইন ইন", err: { Taken: "এই ঠিকানা আগেই নেওয়া হয়েছে।", Invalid: "৩–৩০টি ইংরেজি অক্ষর, সংখ্যা বা হাইফেন দিন।", Reserved: "এই ঠিকানা ব্যবহার করা যাবে না।", Phone: "সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন।", Email: "সঠিক ইমেইল ঠিকানা দিন।", Pin: "পিন ৪ থেকে ৬ সংখ্যার হতে হবে।", Weak: "এই পিন সহজে অনুমান করা যায়।", Code: "কোডটি ভুল বা মেয়াদোত্তীর্ণ।", Failed: "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।" } }
    : { suggest: "These are free, tap one:", title: "Open your store", intro: "Free for 14 days. No payment needed to start.", store: "Store name", address: "Store web address", owner: "Your name", email: "Email", emailHint: "Your login codes arrive here.", phone: "Mobile number (optional)", pin: "PIN (4–6 digits)", code: "6-digit code", send: "Send code", create: "Create store", free: "This address is available", agree: "By continuing you agree to the Terms and Privacy Policy.", have: "Already have a store? Sign in", err: { Taken: "This address is already taken.", Invalid: "Use 3–30 letters, numbers or hyphens.", Reserved: "This address can't be used.", Phone: "Enter a valid 11-digit mobile number.", Email: "Enter a valid email address.", Pin: "PIN must be 4 to 6 digits.", Weak: "That PIN is too easy to guess.", Code: "That code is wrong or expired.", Failed: "Something went wrong. Please try again." } };
  write(`${lang === "en" ? "en/" : ""}signup`, page({
    lang, path: "/signup/", title: `${s.title} | Lalcha POS`, description: s.intro,
    body: `<main><form class="form" id="signup" data-free="${s.free}" data-create="${s.create}" data-err-subdomain-taken="${s.err.Taken}" data-err-invalid-subdomain="${s.err.Invalid}" data-err-reserved-subdomain="${s.err.Reserved}" data-err-invalid-phone="${s.err.Phone}" data-err-invalid-email="${s.err.Email}" data-err-invalid-pin="${s.err.Pin}" data-err-weak-pin="${s.err.Weak}" data-err-invalid-code="${s.err.Code}" data-err-save-failed="${s.err.Failed}">
<h1>${s.title}</h1><p class="note">${s.intro}</p>
<label>${s.store}<input name="storeName" required maxlength="100" autocomplete="organization"></label>
<label>${s.address}<span class="address-field"><input name="subdomain" required maxlength="30" placeholder="mystore" autocapitalize="none" autocomplete="off" spellcheck="false"><span class="address-suffix">.lalcha.com</span></span><span class="hint" id="availability" role="status" aria-live="polite"></span><span class="suggest" id="suggest" data-label="${s.suggest}"></span></label>
<label>${s.owner}<input name="ownerName" required maxlength="100" autocomplete="name"></label>
<label>${s.email}<input name="email" type="email" required maxlength="254" placeholder="you@example.com" autocomplete="email"><span class="hint">${s.emailHint}</span></label>
<label>${s.phone}<input name="phone" inputmode="tel" maxlength="11" placeholder="01XXXXXXXXX" autocomplete="tel"></label>
<label>${s.pin}<input name="pin" required type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
<div id="code-block" hidden><p class="ok" id="dev-code" role="status"></p><label>${s.code}<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label></div>
<p class="error" id="error" role="alert"></p>
<button class="btn" type="submit">${s.send}</button>
<p class="note">${s.agree}</p><p class="note"><a href="${u.prefix}/login/">${s.have}</a></p>
</form></main><script src="${v("signup.js")}" defer></script>`,
  }));

  const l = lang === "bn"
    ? { title: "সাইন ইন", intro: "আপনার ইমেইল দিন। একটা কোড পাঠাব, তারপর সরাসরি আপনার দোকানে নিয়ে যাব।", email: "ইমেইল", send: "কোড পাঠান", code: "৬ সংখ্যার কোড", verify: "সাইন ইন", sent: "এই ইমেইলে কোনো দোকান থাকলে কোড চলে গেছে। স্প্যাম ফোল্ডারও দেখে নিন।", choose: "কোন দোকানে যাবেন?", owner: "মালিক", manager: "ম্যানেজার", paused: "বন্ধ আছে", opening: "আপনার দোকানে নিয়ে যাচ্ছি…", newStore: "+ নতুন দোকান খুলুন", staff: "ক্যাশিয়ার? দোকানের ঠিকানা দিয়ে যান", label: "দোকানের ঠিকানা", go: "দোকানে যান", invalid: "সঠিক দোকানের ঠিকানা দিন।", badCode: "কোডটি ভুল, অথবা মেয়াদ পেরিয়ে গেছে।", expired: "সময় পেরিয়ে গেছে। আবার সাইন ইন করুন।", failed: "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।", none: "নতুন? ফ্রি শুরু করুন" }
    : { title: "Sign in", intro: "Enter your email. We'll send a code, then take you straight to your store.", email: "Email", send: "Send code", code: "6-digit code", verify: "Sign in", sent: "If this email has a store, a code is on its way. Check spam too.", choose: "Which store?", owner: "Owner", manager: "Manager", paused: "Paused", opening: "Taking you to your store…", newStore: "+ Open another store", staff: "Cashier? Go by store address", label: "Store address", go: "Go to store", invalid: "Enter a valid store address.", badCode: "That code is wrong or expired.", expired: "That took too long. Please sign in again.", failed: "Something went wrong. Please try again.", none: "New here? Start free" };
  write(`${lang === "en" ? "en/" : ""}login`, page({
    lang, path: "/login/", title: `${l.title} | Lalcha POS`, description: l.intro,
    body: `<main><div class="form" id="login" data-sent="${l.sent}" data-owner="${l.owner}" data-manager="${l.manager}" data-paused="${l.paused}" data-opening="${l.opening}" data-invalid="${l.invalid}" data-bad-code="${l.badCode}" data-expired="${l.expired}" data-failed="${l.failed}">
<h1>${l.title}</h1>
<form id="step-email"><p class="note">${l.intro}</p><label>${l.email}<input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></label><button class="btn" type="submit">${l.send}</button></form>
<form id="step-code" hidden><p class="ok" id="sent" role="status"></p><label>${l.code}<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></label><button class="btn" type="submit">${l.verify}</button></form>
<section id="step-stores" hidden><h2>${l.choose}</h2><ul class="store-list" id="stores"></ul><p><a class="btn alt small" href="${u.prefix}/signup/">${l.newStore}</a></p></section>
<p class="error" id="error" role="alert"></p>
<details class="staff"><summary>${l.staff}</summary><form id="by-address"><label>${l.label}<input name="subdomain" placeholder="mystore" autocapitalize="none"><span class="hint">mystore.lalcha.com</span></label><button class="btn alt" type="submit">${l.go}</button></form></details>
<p class="note"><a href="${u.prefix}/signup/">${l.none}</a></p>
</div></main><script src="${v("login.js")}" defer></script>`,
  }));

  const k = lang === "bn"
    ? { title: "যোগাযোগ করুন", intro: "প্রশ্ন, ডেমো, অথবা চেইন শপের জন্য কাস্টম সমাধান? লিখুন, আমরা উত্তর দেব।", name: "আপনার নাম", shop: "দোকান বা প্রতিষ্ঠানের নাম", phone: "মোবাইল নম্বর", topic: "বিষয়", topics: [["general", "সাধারণ প্রশ্ন"], ["enterprise", "Enterprise / কাস্টম সমাধান"], ["support", "সাহায্য দরকার"], ["partner", "পার্টনারশিপ"]], message: "বার্তা", send: "ইমেইলে পাঠান", sendNote: "বোতাম চাপলে আপনার ইমেইল অ্যাপ খুলবে, বার্তা লেখা থাকবে।", direct: "সরাসরি ইমেইল", code: "কোড ও বাগ রিপোর্ট", required: "নাম ও বার্তা লিখুন।" }
    : { title: "Contact us", intro: "Questions, a walkthrough, or a custom solution for your chain? Write to us and we'll reply.", name: "Your name", shop: "Shop or company", phone: "Mobile number", topic: "Topic", topics: [["general", "General question"], ["enterprise", "Enterprise / custom solution"], ["support", "I need help"], ["partner", "Partnership"]], message: "Message", send: "Send by email", sendNote: "This opens your email app with the message filled in.", direct: "Email us directly", code: "Code and bug reports", required: "Please enter your name and a message." };
  write(`${lang === "en" ? "en/" : ""}contact`, page({
    lang, path: "/contact/", title: `${k.title} | Lalcha POS`, description: k.intro,
    body: `<main class="contact wrap"><div class="contact-side"><h1>${k.title}</h1><p class="lead">${k.intro}</p>
<div class="contact-ways"><div><span>${k.direct}</span><a href="mailto:${CONTACT}">${CONTACT}</a></div><div><span>${k.code}</span><a href="${REPO}/issues">GitHub</a></div></div></div>
<form class="form" id="contact" data-to="${CONTACT}" data-required="${k.required}">
<label>${k.name}<input name="name" required maxlength="100" autocomplete="name"></label>
<label>${k.shop}<input name="shop" maxlength="100" autocomplete="organization"></label>
<label>${k.phone}<input name="phone" inputmode="tel" maxlength="14" placeholder="01XXXXXXXXX" autocomplete="tel"></label>
<label>${k.topic}<select name="topic">${k.topics.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
<label>${k.message}<textarea name="message" required maxlength="2000" rows="5"></textarea></label>
<p class="error" id="error" role="alert"></p>
<button class="btn" type="submit">${k.send}</button><p class="note">${k.sendNote}</p>
</form></main><script src="${v("contact.js")}" defer></script>`,
  }));
}

const legal = (h1, updated, sections) =>
  `<main class="doc"><h1>${h1}</h1><p class="note">Last updated: ${updated}</p>${sections.map(([h, p]) => `<h2>${h}</h2><p>${p}</p>`).join("")}</main>`;
const UPDATED = "November 2026";

write("terms", page({ lang: "en", alt: false, path: "/terms/", title: "Terms of Service | Lalcha POS", description: "The terms for using the hosted Lalcha POS service at lalcha.com.", body: legal("Terms of Service", UPDATED, [
  ["About these terms", "These terms apply when you use the hosted Lalcha POS service at lalcha.com and its store addresses. The open source software itself is licensed separately under the AGPL-3.0."],
  ["Your account", "You must give accurate information and keep your phone number, PINs and connected devices secure. You are responsible for what your staff do in your store's account."],
  ["Free trial and subscription", "New stores receive a free trial. After that, continued use needs a paid plan. Subscription payments are checked manually and your access is extended after a payment is approved."],
  ["When a subscription ends", "After a grace period, selling and changes are paused until you renew. Your data remains readable, and sales already recorded on your devices can still upload."],
  ["Your data", "Your store's data belongs to you. We process it only to provide the service. See the Privacy Policy for details."],
  ["Your legal duties", "You are responsible for following the laws that apply to your business, including VAT and invoicing rules. VAT features are tools to help you and are not tax or legal advice."],
  ["Acceptable use", "You must not use the service for illegal activity, attempt to reach another store's data, or disrupt the service."],
  ["Suspension", "We may suspend an account that breaks these terms or puts the service or other users at risk."],
  ["Availability and liability", "The service is provided as it is, without a guarantee of uninterrupted operation. To the extent the law allows, we are not liable for indirect losses or lost profits."],
  ["Governing law", "These terms are governed by the laws of Bangladesh."],
  ["Contact", `Questions about these terms can be sent to ${CONTACT}.`],
]) }));
write("privacy", page({ lang: "en", alt: false, path: "/privacy/", title: "Privacy Policy | Lalcha POS", description: "How the hosted Lalcha POS service collects, uses and protects information.", body: legal("Privacy Policy", UPDATED, [
  ["What we collect", "Account details such as store name, owner and staff names and mobile numbers; business records you enter such as products, sales, stock, suppliers and customers; subscription payment details such as transaction IDs; and basic technical records needed to run and secure the service."],
  ["PINs and codes", "PINs and login codes are stored only as one-way protected values. Connected devices may keep a protected copy of a PIN so staff can sign in during an internet outage."],
  ["How we use it", "To provide the service, keep accounts secure, process subscriptions, give support and meet legal duties. We do not sell your data."],
  ["Your customers' information", "When you record customer names and phone numbers, you control that information and are responsible for having a proper reason to keep it. We process it on your behalf."],
  ["Who receives it", "Only service providers needed to run the service, such as hosting, delivery of SMS login codes and backups, or where the law requires it."],
  ["Storing data", "Information is kept while your account is active and for as long as needed for legal and backup purposes. It is also stored on devices you connect until those devices are cleared."],
  ["Isolation and security", "Each store's records are separated at database level, and staff access is limited by role. No system is perfectly secure, so please disconnect lost devices promptly."],
  ["Your choices", `You can ask to see, correct or delete your information by writing to ${CONTACT}.`],
]) }));
write("open-source", page({ lang: "en", alt: false, path: "/open-source/", title: "Open Source POS for Bangladesh | Lalcha POS", description: "Lalcha POS is open source under the AGPL-3.0. Inspect the code, self-host it for your shop, or contribute on GitHub.", body: legal("Open source", UPDATED, [
  ["Built in the open", `The full Lalcha POS source code is public on <a href="${REPO}">GitHub</a> under the AGPL-3.0 license.`],
  ["What you can do", "Read the code, run it for your own business, change it, and share your improvements."],
  ["If you offer it as a service", "The AGPL-3.0 requires anyone who runs a modified version for users over a network to offer those users its source code."],
  ["Hosted or self-hosted", "Hosting it yourself gives you full control, and you handle servers, backups and updates. Our hosted service at lalcha.com handles those for you."],
  ["The name", "The code is open, but the Lalcha name and logo identify this project and our hosted service. If you publish a modified version, please give it a clearly different name."],
  ["Contribute", `Bug reports, translations and code are welcome on <a href="${REPO}">GitHub</a>.`],
]) }));
writeFileSync(join(dist, "404.html"), page({ lang: "en", alt: false, noindex: true, path: "/404", title: "Page not found | Lalcha POS", description: "This page could not be found.", body: `<main class="doc"><h1>Page not found</h1><p><a class="btn" href="/">Go home</a></p></main>` }));

/* ---------- One page per kind of shop, and a page listing them ---------- */

const shopUi = {
  en: { all: "Lalcha POS for every kind of shop", allLead: "Pick your kind of shop to see what Lalcha POS does for it. Every shop gets billing, stock, baki, suppliers, returns, reports, staff and branches.", features: "What you get", how: "How to start", faq: "Questions", start: "Start free for 14 days", demo: "Try the demo", home: "Home", others: "Other kinds of shop", trial: "14 days free · No payment needed · Works without internet" },
  bn: { all: "সব ধরনের দোকানের জন্য Lalcha POS", allLead: "আপনার দোকানের ধরন বেছে নিন, দেখুন Lalcha POS সেখানে কী কী করে। সব দোকানেই থাকছে বিল, স্টক, বাকির খাতা, সরবরাহকারী, ফেরত, রিপোর্ট, কর্মী আর শাখা।", features: "যা যা পাবেন", how: "কীভাবে শুরু করবেন", faq: "প্রশ্ন ও উত্তর", start: "১৪ দিন ফ্রি শুরু করুন", demo: "ডেমো দেখুন", home: "হোম", others: "অন্য ধরনের দোকান", trial: "১৪ দিন ফ্রি · কোনো পেমেন্ট লাগবে না · ইন্টারনেট ছাড়াও চলে" },
};

for (const lang of ["bn", "en"]) {
  const u = ui[lang];
  const s = shopUi[lang];
  const base = lang === "en" ? "en/" : "";
  write(`${base}for`, page({
    lang, path: "/for/", title: `${s.all} | Lalcha POS`, description: s.allLead,
    schema: [crumbs([[s.home, `${u.prefix}/`], [u.shopTypes, `${u.prefix}/for/`]]), { "@context": "https://schema.org", "@type": "ItemList", itemListElement: SHOPS.map((x, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}${u.prefix}/for/${x.slug}/`, name: x[lang].h1 })) }],
    body: `<main><section class="hero"><div class="wrap"><h1>${s.all}</h1><p class="lead">${s.allLead}</p></div></section>
<section class="band"><div class="wrap"><div class="grid shops">${SHOPS.map((x) => `<a class="card shop" href="${u.prefix}/for/${x.slug}/"><span class="shop-icon">${shopIcon(x.type)}</span><h2>${x[lang].name}</h2><p>${x[lang].description}</p></a>`).join("")}</div></div></section></main>`,
  }));

  for (const shop of SHOPS) {
    const c = shop[lang];
    const path = `/for/${shop.slug}/`;
    const signup = `${u.prefix}/signup/?type=${shop.type}`;
    write(`${base}for/${shop.slug}`, page({
      lang, path, title: c.title, description: c.description,
      schema: [
        crumbs([[s.home, `${u.prefix}/`], [u.shopTypes, `${u.prefix}/for/`], [c.name, `${u.prefix}${path}`]]),
        {
          "@context": "https://schema.org", "@type": "SoftwareApplication", name: `Lalcha POS — ${c.name}`, applicationCategory: "BusinessApplication", applicationSubCategory: "Point of sale",
          operatingSystem: "Web, Android, iOS, Windows, macOS", url: `${SITE}${u.prefix}${path}`, description: c.lead, inLanguage: ["bn", "en"], publisher: { "@id": `${SITE}/#org` },
          audience: { "@type": "BusinessAudience", audienceType: c.name, geographicArea: { "@type": "Country", name: "Bangladesh" } },
          featureList: c.features.map(([h]) => h),
          offers: [{ "@type": "Offer", name: "Starter", price: "499", priceCurrency: "BDT" }, { "@type": "Offer", name: "Growth", price: "999", priceCurrency: "BDT" }],
        },
        { "@context": "https://schema.org", "@type": "HowTo", name: c.h1, step: c.steps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })) },
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: c.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
      ],
      body: `<main>
<nav class="crumbs wrap" aria-label="Breadcrumb"><a href="${u.prefix}/">${s.home}</a> › <a href="${u.prefix}/for/">${u.shopTypes}</a> › <span>${c.name}</span></nav>
<section class="hero"><div class="wrap"><p class="shop-icon big">${shopIcon(shop.type)}</p><h1>${c.h1}</h1><p class="lead answer">${c.lead}</p>
<div class="cta"><a class="btn" href="${signup}">${s.start}</a><a class="btn alt" href="${DEMO_URL}" target="_blank" rel="noopener">${s.demo}</a></div><p class="note">${s.trial}</p></div></section>
<section class="band alt"><div class="wrap"><h2>${s.features}</h2><div class="grid">${c.features.map(([h, p]) => `<article class="card"><h3>${h}</h3><p>${p}</p></article>`).join("")}</div></div></section>
<section class="band"><div class="wrap"><h2>${s.how}</h2><ol class="steps">${c.steps.map((x) => `<li>${x}</li>`).join("")}</ol><p><a class="btn" href="${signup}">${s.start}</a></p></div></section>
<section class="band alt"><div class="wrap"><h2>${s.faq}</h2>${c.faq.map(([q, a]) => `<details open><summary>${q}</summary><p>${a}</p></details>`).join("")}</div></section>
<section class="band"><div class="wrap"><h2>${s.others}</h2><p class="chips">${SHOPS.filter((x) => x !== shop).map((x) => `<a href="${u.prefix}/for/${x.slug}/">${shopIcon(x.type)}${x[lang].name}</a>`).join("")}</p></div></section>
</main>`,
    }));
  }
}

/* ---------- Sitemap, robots and llms.txt ---------- */

const today = new Date().toISOString().slice(0, 10);
const entry = (loc, alternates) =>
  `<url><loc>${SITE}${loc}</loc><lastmod>${today}</lastmod>${alternates.map(([l, href]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${href}"/>`).join("")}</url>`;
const sitemap = pages.flatMap((p) =>
  p.alt
    ? [entry(p.path, [["bn", p.path], ["en", `/en${p.path}`], ["x-default", p.path]]), entry(`/en${p.path}`, [["bn", p.path], ["en", `/en${p.path}`], ["x-default", p.path]])]
    : [entry(p.path, [])],
);
writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sitemap.join("\n")}\n</urlset>\n`);

// AI search and assistants are welcome: they read the same public pages people do.
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /signup/?\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

const en = (x) => x.en;
writeFileSync(join(dist, "llms.txt"), `# Lalcha POS

> Lalcha POS is an open source (AGPL-3.0), offline-first point of sale and shop management app for small and medium shops in Bangladesh. It works in Bangla and English, in any browser, and keeps selling without internet. Hosted plans start at ৳499 per month after a 14-day free trial.

Key facts:
- Billing with product photos and barcode scanners; loose goods by kg, litre, metre or feet; packs and variants.
- Baki (customer credit) with limits; suppliers, purchases and dues; returns; staff roles with PINs; multiple branches.
- Optional features per shop type: batches and expiry dates, IMEI/serial numbers with warranty, restaurant tables and kitchen tickets, loyalty points, coupons and gift cards, expenses with profit and loss.
- Payments recorded: cash, bKash, Nagad, card and baki. Mushak 6.3 VAT details on invoices.
- Direct printing to ESC/POS thermal printers (Bangla included) and cash drawer, in Chrome or Edge.

## Pages for each kind of shop
${SHOPS.map((x) => `- [${en(x).h1}](${SITE}/en/for/${x.slug}/): ${en(x).description}`).join("\n")}

## Main pages
- [Home (Bangla)](${SITE}/): overview, live demo and pricing
- [Home (English)](${SITE}/en/)
- [Live demo](https://demo.lalcha.com/): a sample shop that resets every hour
- [Contact](${SITE}/en/contact/)
- [Open source](${SITE}/open-source/)

## Optional
- [Full details for AI assistants](${SITE}/llms-full.txt)
- [Source code](${REPO})
`);
writeFileSync(join(dist, "llms-full.txt"), `# Lalcha POS — full details

${home.en.description}

## Features
${home.en.list.map(([h, p]) => `- ${h}: ${p}`).join("\n")}

## Pricing
- Starter: ৳499 per month, 2 devices, 1 branch
- Growth: ৳999 per month, 5 devices, 3 branches
- Enterprise: custom, for chains and special needs (contact ${CONTACT})
- 14-day free trial, no payment needed to start

## Frequently asked questions
${home.en.faq.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}

${SHOPS.map((x) => `## ${en(x).h1}
${en(x).lead}

${en(x).features.map(([h, p]) => `- ${h}: ${p}`).join("\n")}

${en(x).faq.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}

Page: ${SITE}/en/for/${x.slug}/ (Bangla: ${SITE}/for/${x.slug}/)`).join("\n\n")}
`);
console.log(`Website built: ${pages.length} pages (${sitemap.length} sitemap entries)`);
