// Builds the public website as plain HTML, so search engines can read every page and it loads fast on mobile data.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const SITE = "https://lalcha.com";
const REPO = "https://github.com/masterbase-creator/lalcha-pos";
const CONTACT = "hello@lalcha.com";
/** The public demo store. Local preview overrides it, see the root package.json. */
const DEMO_URL = process.env.DEMO_URL ?? "https://demo.lalcha.com/";
/** Shown above the demo frame. Always the public address, even in a local preview. */
const DEMO_LABEL = "demo.lalcha.com";
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, "public"), dist, { recursive: true });

const ui = {
  en: {
    prefix: "/en", other: "/", otherLabel: "বাংলা", locale: "en_US",
    demo: "Demo", contact: "Contact", features: "Features", pricing: "Pricing", openSource: "Open source", signIn: "Sign in", start: "Start free", privacy: "Privacy", terms: "Terms",
    rights: "Lalcha POS. Open source software for shops in Bangladesh.",
  },
  bn: {
    prefix: "", other: "/en/", otherLabel: "English", locale: "bn_BD",
    demo: "ডেমো", contact: "যোগাযোগ", features: "সুবিধা", pricing: "মূল্য", openSource: "ওপেন সোর্স", signIn: "সাইন ইন", start: "ফ্রি শুরু করুন", privacy: "প্রাইভেসি", terms: "শর্তাবলি",
    rights: "Lalcha POS। বাংলাদেশের দোকানের জন্য ওপেন সোর্স সফটওয়্যার।",
  },
};

function page({ lang, path, title, description, body, alt = true, schema = [], noindex = false }) {
  const u = ui[lang];
  const canonical = `${SITE}${alt ? u.prefix : ""}${path}`;
  const links = alt
    ? `<link rel="alternate" hreflang="bn" href="${SITE}${path}"><link rel="alternate" hreflang="en" href="${SITE}/en${path}"><link rel="alternate" hreflang="x-default" href="${SITE}${path}">`
    : "";
  const otherHref = alt ? (lang === "bn" ? `/en${path}` : path) : u.other;
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
<meta name="twitter:card" content="summary">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
${schema.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join("\n")}
</head>
<body>
<header class="site"><div class="wrap">
<a class="logo" href="${u.prefix}/"><img src="/icon.svg" alt="" width="38" height="38">Lalcha POS</a>
<nav class="top" aria-label="Main">
<a href="${u.prefix}/#live">${u.demo}</a><a href="${u.prefix}/#features">${u.features}</a><a href="${u.prefix}/#pricing">${u.pricing}</a><a href="/open-source/">${u.openSource}</a><a href="${u.prefix}/contact/">${u.contact}</a><a href="${otherHref}">${u.otherLabel}</a><a href="${u.prefix}/login/">${u.signIn}</a><a class="btn small" href="${u.prefix}/signup/">${u.start}</a>
</nav>
</div></header>
${body}
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${u.rights}</span>
<nav aria-label="Footer"><a href="/open-source/">${u.openSource}</a><a href="/terms/">${u.terms}</a><a href="/privacy/">${u.privacy}</a><a href="${u.prefix}/contact/">${u.contact}</a><a href="${REPO}">GitHub</a><a href="mailto:${CONTACT}">${CONTACT}</a></nav>
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
    ],
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
    ],
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
<section class="band" id="pricing"><div class="wrap"><h2>${c.pricingTitle}</h2><div class="grid">${plans.map(([n, p, d, b]) => `<article class="card"><h3>${n}</h3><div class="price">${p}</div><p>${c.month} · ${d} ${c.devices} · ${b} ${c.branches}</p><p style="margin-top:14px"><a class="btn small" href="${u.prefix}/signup/">${c.choose}</a></p></article>`).join("")}<article class="card"><h3>${c.enterprise}</h3><div class="price">${c.custom}</div><p>${c.enterpriseText}</p><p style="margin-top:14px"><a class="btn small alt" href="${u.prefix}/contact/?topic=enterprise">${c.talk}</a></p></article></div></div></section>
<section class="band alt"><div class="wrap"><h2>${c.faqTitle}</h2>${c.faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}</div></section>
</main>`;
  const schema = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Lalcha POS", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: SITE, description: c.description, inLanguage: ["bn", "en"], license: "https://www.gnu.org/licenses/agpl-3.0.html", offers: { "@type": "Offer", price: "499", priceCurrency: "BDT" } },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: c.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  write(lang === "en" ? "en" : "", page({ lang, path: "/", title: c.title, description: c.description, body, schema }));

  const s = lang === "bn"
    ? { title: "আপনার দোকান খুলুন", intro: "১৪ দিন ফ্রি। শুরু করতে কোনো পেমেন্ট লাগবে না।", store: "দোকানের নাম", address: "দোকানের ওয়েব ঠিকানা", owner: "আপনার নাম", email: "ইমেইল", emailHint: "লগইন কোড এখানে আসবে।", phone: "মোবাইল নম্বর (ঐচ্ছিক)", pin: "পিন (৪–৬ সংখ্যা)", code: "৬ সংখ্যার কোড", send: "কোড পাঠান", create: "দোকান তৈরি করুন", free: "এই ঠিকানা পাওয়া যাচ্ছে", agree: "চালিয়ে গেলে আপনি শর্তাবলি ও প্রাইভেসি নীতিতে সম্মত হচ্ছেন।", have: "দোকান আছে? সাইন ইন", err: { Taken: "এই ঠিকানা আগেই নেওয়া হয়েছে।", Invalid: "৩–৩০টি ইংরেজি অক্ষর, সংখ্যা বা হাইফেন দিন।", Reserved: "এই ঠিকানা ব্যবহার করা যাবে না।", Phone: "সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন।", Email: "সঠিক ইমেইল ঠিকানা দিন।", Pin: "পিন ৪ থেকে ৬ সংখ্যার হতে হবে।", Weak: "এই পিন সহজে অনুমান করা যায়।", Code: "কোডটি ভুল বা মেয়াদোত্তীর্ণ।", Failed: "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।" } }
    : { title: "Open your store", intro: "Free for 14 days. No payment needed to start.", store: "Store name", address: "Store web address", owner: "Your name", email: "Email", emailHint: "Your login codes arrive here.", phone: "Mobile number (optional)", pin: "PIN (4–6 digits)", code: "6-digit code", send: "Send code", create: "Create store", free: "This address is available", agree: "By continuing you agree to the Terms and Privacy Policy.", have: "Already have a store? Sign in", err: { Taken: "This address is already taken.", Invalid: "Use 3–30 letters, numbers or hyphens.", Reserved: "This address can't be used.", Phone: "Enter a valid 11-digit mobile number.", Email: "Enter a valid email address.", Pin: "PIN must be 4 to 6 digits.", Weak: "That PIN is too easy to guess.", Code: "That code is wrong or expired.", Failed: "Something went wrong. Please try again." } };
  write(`${lang === "en" ? "en/" : ""}signup`, page({
    lang, path: "/signup/", title: `${s.title} | Lalcha POS`, description: s.intro,
    body: `<main><form class="form" id="signup" data-free="${s.free}" data-create="${s.create}" data-err-subdomain-taken="${s.err.Taken}" data-err-invalid-subdomain="${s.err.Invalid}" data-err-reserved-subdomain="${s.err.Reserved}" data-err-invalid-phone="${s.err.Phone}" data-err-invalid-email="${s.err.Email}" data-err-invalid-pin="${s.err.Pin}" data-err-weak-pin="${s.err.Weak}" data-err-invalid-code="${s.err.Code}" data-err-save-failed="${s.err.Failed}">
<h1>${s.title}</h1><p class="note">${s.intro}</p>
<label>${s.store}<input name="storeName" required maxlength="100" autocomplete="organization"></label>
<label>${s.address}<input name="subdomain" required maxlength="30" placeholder="mystore" autocapitalize="none"><span class="hint">mystore.lalcha.com</span><span class="hint" id="availability" role="status"></span></label>
<label>${s.owner}<input name="ownerName" required maxlength="100" autocomplete="name"></label>
<label>${s.email}<input name="email" type="email" required maxlength="254" placeholder="you@example.com" autocomplete="email"><span class="hint">${s.emailHint}</span></label>
<label>${s.phone}<input name="phone" inputmode="tel" maxlength="11" placeholder="01XXXXXXXXX" autocomplete="tel"></label>
<label>${s.pin}<input name="pin" required type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
<div id="code-block" hidden><p class="ok" id="dev-code" role="status"></p><label>${s.code}<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label></div>
<p class="error" id="error" role="alert"></p>
<button class="btn" type="submit">${s.send}</button>
<p class="note">${s.agree}</p><p class="note"><a href="${u.prefix}/login/">${s.have}</a></p>
</form></main><script src="/signup.js" defer></script>`,
  }));

  const l = lang === "bn"
    ? { title: "সাইন ইন", intro: "আপনার দোকানের ঠিকানা লিখুন।", label: "দোকানের ঠিকানা", go: "আমার দোকানে যান", invalid: "সঠিক দোকানের ঠিকানা দিন।", none: "নতুন দোকান? ফ্রি শুরু করুন" }
    : { title: "Sign in", intro: "Enter your store's address.", label: "Store address", go: "Go to my store", invalid: "Enter a valid store address.", none: "New here? Start free" };
  write(`${lang === "en" ? "en/" : ""}login`, page({
    lang, path: "/login/", title: `${l.title} | Lalcha POS`, description: l.intro,
    body: `<main><form class="form" id="login" data-invalid="${l.invalid}"><h1>${l.title}</h1><p class="note">${l.intro}</p><label>${l.label}<input name="subdomain" required placeholder="mystore" autocapitalize="none"><span class="hint">mystore.lalcha.com</span></label><p class="error" id="error" role="alert"></p><button class="btn" type="submit">${l.go}</button><p class="note"><a href="${u.prefix}/signup/">${l.none}</a></p></form></main><script src="/login.js" defer></script>`,
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
</form></main><script src="/contact.js" defer></script>`,
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

const urls = ["/", "/en/", "/signup/", "/en/signup/", "/login/", "/en/login/", "/contact/", "/en/contact/", "/open-source/", "/terms/", "/privacy/"];
writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
console.log(`Website built: ${urls.length} pages`);
