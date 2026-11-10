// What each page looks like when its link is shared. The site build points each page's tags at an
// image named here; og-render.mjs draws every image in this list. Keeping both in one place means a
// page can never point at a picture that doesn't exist.
import { SHOPS } from "./shops.mjs";

const CHIPS = {
  bn: ["১৪ দিন ফ্রি", "ইন্টারনেট ছাড়াও চলে", "বাংলা ও English"],
  en: ["14 days free", "Works offline", "Bangla + English"],
};

const GENERAL = {
  home: {
    bn: { eyebrow: "দোকানের POS সফটওয়্যার", title: "দোকান চালানোর সবচেয়ে সহজ উপায়", subtitle: "ছবিতে ট্যাপ করলেই বিল। স্টক, বাকির খাতা, ক্রয়, ভ্যাট আর লাভের হিসাব, বাংলায়।" },
    en: { eyebrow: "POS software for shops in Bangladesh", title: "The easiest way to run your shop", subtitle: "Tap a photo to bill. Stock, baki, purchases, VAT and profit, in Bangla or English." },
  },
  for: {
    bn: { eyebrow: "১৮ ধরনের দোকানের জন্য", title: "আপনার দোকানের মতো করে বানানো", subtitle: "মুদি, ফার্মেসি, রেস্টুরেন্ট, হার্ডওয়্যার, মোবাইল, কাপড়, জুয়েলারি আর আরও অনেক দোকান।" },
    en: { eyebrow: "Built for 18 kinds of shop", title: "Made for your kind of shop", subtitle: "Grocery, pharmacy, restaurant, hardware, mobile, clothing, jewellery and many more." },
  },
  signup: {
    bn: { eyebrow: "কোনো পেমেন্ট লাগবে না", title: "আজই নিজের দোকান খুলুন, ১৪ দিন ফ্রি", subtitle: "নিজের ঠিকানা, নিজের নাম আর লোগো। কয়েক মিনিটেই বিক্রি শুরু।" },
    en: { eyebrow: "No payment needed", title: "Open your store today, free for 14 days", subtitle: "Your own address, your own name and logo. Selling in a few minutes." },
  },
};

const slugOf = (path) => (path === "/" ? "home" : path.replace(/^\/|\/$/g, "").replace(/\//g, "-"));

/** Every share image to draw, by file name. */
export function shareImages() {
  const list = [];
  for (const lang of ["bn", "en"]) {
    for (const [name, copy] of Object.entries(GENERAL)) list.push({ file: `${name}-${lang}.png`, spec: { lang, ...copy[lang], chips: CHIPS[lang] } });
    for (const shop of SHOPS) {
      const c = shop[lang];
      list.push({
        file: `for-${shop.slug}-${lang}.png`,
        spec: { lang, eyebrow: c.name, title: c.h1, subtitle: c.features.slice(0, 2).map(([h]) => h).join(" · "), shopType: shop.type, chips: CHIPS[lang].slice(0, 2) },
      });
    }
  }
  return list;
}

/** The image a page uses, and words describing it for screen readers. Pages without their own use the home one. */
export function shareImageFor(lang, path) {
  const want = `${slugOf(path)}-${lang}.png`;
  const found = shareImages().find((i) => i.file === want) ?? shareImages().find((i) => i.file === `home-${lang}.png`);
  return { file: found.file, alt: `${found.spec.title} · Lalcha POS` };
}
