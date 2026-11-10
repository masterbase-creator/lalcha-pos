/**
 * Kinds of shop, and what each one gets switched on during onboarding. An owner can change any of
 * this later in Settings; the type only decides sensible starting choices and product categories.
 */

export const FEATURES = ["batches", "serials", "restaurant", "loyalty", "accounting"] as const;
export type Feature = (typeof FEATURES)[number];

export const BUSINESS_TYPES = ["grocery", "general_store", "pharmacy", "restaurant", "tea_stall", "hardware", "furniture", "electronics", "auto_parts", "fashion", "jewellery", "cosmetics", "optical", "stationery", "bakery", "agro", "wholesale", "general"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

type Text = { en: string; bn: string };

export const CATEGORY_LABELS = {
  // Grocery and everyday goods
  staples: { en: "Rice, dal & flour", bn: "চাল-ডাল-আটা" },
  oil_spice: { en: "Oil & spices", bn: "তেল ও মসলা" },
  drinks: { en: "Drinks", bn: "পানীয়" },
  snacks: { en: "Snacks", bn: "নাস্তা" },
  fresh: { en: "Fresh", bn: "কাঁচাবাজার" },
  home_care: { en: "Home care", bn: "ঘরের জিনিস" },
  personal_care: { en: "Personal care", bn: "ব্যক্তিগত যত্ন" },
  baby: { en: "Baby care", bn: "শিশুর যত্ন" },
  // Pharmacy
  tablets: { en: "Tablets & capsules", bn: "ট্যাবলেট ও ক্যাপসুল" },
  syrups: { en: "Syrups & suspensions", bn: "সিরাপ ও সাসপেনশন" },
  injections: { en: "Injections", bn: "ইনজেকশন" },
  topical: { en: "Ointments & drops", bn: "মলম ও ড্রপ" },
  surgical: { en: "Surgical & devices", bn: "সার্জিক্যাল ও মেডিকেল যন্ত্র" },
  // Restaurant and café
  meals: { en: "Meals", bn: "খাবার" },
  fast_food: { en: "Fast food", bn: "ফাস্ট ফুড" },
  tea_coffee: { en: "Tea & coffee", bn: "চা-কফি" },
  desserts: { en: "Desserts", bn: "মিষ্টি ও ডেজার্ট" },
  // Hardware
  pipes: { en: "Pipes & fittings", bn: "পাইপ ও ফিটিংস" },
  electrical: { en: "Electrical", bn: "ইলেকট্রিক" },
  paint: { en: "Paint", bn: "রং" },
  tools: { en: "Tools", bn: "যন্ত্রপাতি" },
  sanitary: { en: "Sanitary", bn: "স্যানিটারি" },
  building: { en: "Building materials", bn: "নির্মাণসামগ্রী" },
  fasteners: { en: "Nuts, bolts & nails", bn: "নাট-বল্টু ও পেরেক" },
  // Electronics and mobile
  mobiles: { en: "Mobile phones", bn: "মোবাইল ফোন" },
  gadget_accessories: { en: "Accessories", bn: "এক্সেসরিজ" },
  computers: { en: "Computers", bn: "কম্পিউটার" },
  appliances: { en: "Appliances", bn: "ইলেকট্রনিক সামগ্রী" },
  parts: { en: "Spare parts", bn: "পার্টস" },
  // Clothing and fashion
  mens: { en: "Men", bn: "ছেলেদের" },
  womens: { en: "Women", bn: "মেয়েদের" },
  kids: { en: "Kids", bn: "শিশুদের" },
  footwear: { en: "Footwear", bn: "জুতা" },
  fabric: { en: "Fabric", bn: "থান কাপড়" },
  fashion_accessories: { en: "Accessories", bn: "এক্সেসরিজ" },
  // Cosmetics
  skin_care: { en: "Skin care", bn: "ত্বকের যত্ন" },
  hair_care: { en: "Hair care", bn: "চুলের যত্ন" },
  makeup: { en: "Makeup", bn: "মেকআপ" },
  fragrance: { en: "Fragrance", bn: "সুগন্ধি" },
  // Stationery and books
  books: { en: "Books", bn: "বই" },
  notebooks: { en: "Notebooks & paper", bn: "খাতা ও কাগজ" },
  pens: { en: "Pens & pencils", bn: "কলম ও পেন্সিল" },
  office: { en: "Office supplies", bn: "অফিস সামগ্রী" },
  print_copy: { en: "Print & photocopy", bn: "প্রিন্ট ও ফটোকপি" },
  toys: { en: "Toys", bn: "খেলনা" },
  // General store
  kitchenware: { en: "Kitchenware & plastic", bn: "হাঁড়ি-পাতিল ও প্লাস্টিক" },
  gifts: { en: "Gifts & decor", bn: "গিফট ও সাজসজ্জা" },
  // Tea stall
  paan: { en: "Paan & cigarettes", bn: "পান ও সিগারেট" },
  // Furniture
  beds: { en: "Beds & khat", bn: "খাট ও বিছানা" },
  sofas: { en: "Sofas", bn: "সোফা" },
  tables_chairs: { en: "Tables & chairs", bn: "টেবিল ও চেয়ার" },
  wardrobes: { en: "Almirahs & wardrobes", bn: "আলমারি ও ওয়ারড্রোব" },
  office_furniture: { en: "Office furniture", bn: "অফিস ফার্নিচার" },
  mattresses: { en: "Mattresses", bn: "তোশক ও ম্যাট্রেস" },
  // Jewellery
  gold: { en: "Gold", bn: "সোনা" },
  silver: { en: "Silver", bn: "রুপা" },
  diamond: { en: "Diamond", bn: "হীরা" },
  imitation: { en: "Imitation jewellery", bn: "ইমিটেশন গহনা" },
  // Agro
  seeds: { en: "Seeds", bn: "বীজ" },
  fertiliser: { en: "Fertiliser", bn: "সার" },
  pesticides: { en: "Pesticides", bn: "কীটনাশক" },
  animal_feed: { en: "Animal & fish feed", bn: "পশু ও মাছের খাদ্য" },
  farm_tools: { en: "Farm tools", bn: "কৃষি যন্ত্রপাতি" },
  // Auto parts
  engine_parts: { en: "Engine parts", bn: "ইঞ্জিনের পার্টস" },
  tyres: { en: "Tyres & tubes", bn: "টায়ার ও টিউব" },
  lubricants: { en: "Engine oil & lubricants", bn: "মবিল ও লুব্রিকেন্ট" },
  batteries: { en: "Batteries", bn: "ব্যাটারি" },
  bike_parts: { en: "Motorcycle parts", bn: "মোটরসাইকেলের পার্টস" },
  // Optical
  frames: { en: "Frames", bn: "চশমার ফ্রেম" },
  lenses: { en: "Lenses", bn: "লেন্স" },
  sunglasses: { en: "Sunglasses", bn: "সানগ্লাস" },
  contact_lenses: { en: "Contact lenses", bn: "কন্টাক্ট লেন্স" },
  // Bakery and sweets
  bread: { en: "Bread", bn: "পাউরুটি ও বান" },
  cakes: { en: "Cakes", bn: "কেক" },
  biscuits: { en: "Biscuits & cookies", bn: "বিস্কুট" },
  sweets: { en: "Sweets", bn: "মিষ্টি" },
  other: { en: "Other", bn: "অন্যান্য" },
} as const satisfies Record<string, Text>;

export type Category = keyof typeof CATEGORY_LABELS;
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];

export type BusinessProfile = {
  name: Text;
  /** One line under the name on the onboarding card. */
  pitch: Text;
  icon: string;
  features: Feature[];
  categories: Category[];
};

export const BUSINESS_PROFILES: Record<BusinessType, BusinessProfile> = {
  grocery: {
    name: { en: "Grocery shop", bn: "মুদি দোকান" },
    pitch: { en: "Loose rice, oil by the litre, baki khata.", bn: "খোলা চাল, লিটারে তেল, বাকির খাতা।" },
    icon: "🛒",
    features: ["loyalty", "accounting"],
    categories: ["staples", "oil_spice", "drinks", "snacks", "fresh", "home_care", "personal_care", "baby", "other"],
  },
  general_store: {
    name: { en: "General store", bn: "জেনারেল স্টোর" },
    pitch: { en: "Groceries, cosmetics, stationery, plasticware and toys under one roof.", bn: "মুদি, কসমেটিকস, স্টেশনারি, প্লাস্টিক আর খেলনা, সব এক দোকানে।" },
    icon: "🏬",
    features: ["loyalty", "accounting"],
    categories: ["staples", "snacks", "drinks", "personal_care", "skin_care", "baby", "home_care", "kitchenware", "notebooks", "pens", "toys", "gifts", "electrical", "other"],
  },
  tea_stall: {
    name: { en: "Tea stall", bn: "চায়ের দোকান" },
    pitch: { en: "Fast billing for tea, biscuits and paan, plus a baki list for regulars.", bn: "চা, বিস্কুট, পানের দ্রুত বিল, আর নিয়মিতদের বাকির খাতা।" },
    icon: "☕",
    features: ["accounting"],
    categories: ["tea_coffee", "biscuits", "bread", "snacks", "drinks", "paan", "other"],
  },
  furniture: {
    name: { en: "Furniture", bn: "ফার্নিচার" },
    pitch: { en: "Big-ticket items, advance payments, instalments on baki.", bn: "দামি মাল, অগ্রিম টাকা, বাকিতে কিস্তি।" },
    icon: "🛋️",
    features: ["accounting"],
    categories: ["beds", "sofas", "tables_chairs", "wardrobes", "office_furniture", "mattresses", "other"],
  },
  jewellery: {
    name: { en: "Jewellery", bn: "জুয়েলারি" },
    pitch: { en: "Sell by vori or gram, making charges, regular customers.", bn: "ভরি বা গ্রামে বিক্রি, মজুরি, নিয়মিত ক্রেতা।" },
    icon: "💍",
    features: ["loyalty", "accounting"],
    categories: ["gold", "silver", "diamond", "imitation", "other"],
  },
  agro: {
    name: { en: "Agro & fertiliser", bn: "কৃষি ও সারের দোকান" },
    pitch: { en: "Seed and pesticide batches with expiry, sacks and kg, season baki.", bn: "বীজ আর কীটনাশকের ব্যাচ ও মেয়াদ, বস্তা ও কেজি, মৌসুমি বাকি।" },
    icon: "🌾",
    features: ["batches", "accounting"],
    categories: ["seeds", "fertiliser", "pesticides", "animal_feed", "farm_tools", "other"],
  },
  auto_parts: {
    name: { en: "Auto & motorcycle parts", bn: "অটো ও মোটরসাইকেল পার্টস" },
    pitch: { en: "Parts by size and model, engine oil by the litre, mechanic baki.", bn: "সাইজ ও মডেল ধরে পার্টস, লিটারে মবিল, মেকানিকের বাকি।" },
    icon: "🏍️",
    features: ["accounting"],
    categories: ["engine_parts", "bike_parts", "tyres", "lubricants", "batteries", "other"],
  },
  optical: {
    name: { en: "Optical shop", bn: "চশমার দোকান" },
    pitch: { en: "Frames and lenses on one bill, advance on order, points for regulars.", bn: "ফ্রেম আর লেন্স এক বিলে, অর্ডারে অগ্রিম, নিয়মিতদের পয়েন্ট।" },
    icon: "👓",
    features: ["loyalty", "accounting"],
    categories: ["frames", "lenses", "sunglasses", "contact_lenses", "topical", "other"],
  },
  wholesale: {
    name: { en: "Wholesale & dealer", bn: "পাইকারি ও ডিলার" },
    pitch: { en: "Cartons and sacks, big baki accounts, supplier and retailer dues.", bn: "কার্টন আর বস্তা, বড় বাকির হিসাব, মহাজন আর খুচরা দোকানের পাওনা।" },
    icon: "📦",
    features: ["accounting"],
    categories: ["staples", "oil_spice", "drinks", "snacks", "home_care", "personal_care", "other"],
  },
  pharmacy: {
    name: { en: "Pharmacy", bn: "ফার্মেসি" },
    pitch: { en: "Batch numbers, expiry alerts, search by generic name.", bn: "ব্যাচ নম্বর, মেয়াদের সতর্কতা, জেনেরিক নামে খোঁজা।" },
    icon: "💊",
    features: ["batches", "loyalty", "accounting"],
    categories: ["tablets", "syrups", "injections", "topical", "surgical", "baby", "personal_care", "other"],
  },
  restaurant: {
    name: { en: "Restaurant & café", bn: "রেস্টুরেন্ট ও ক্যাফে" },
    pitch: { en: "Tables, kitchen tickets, extras like more cheese.", bn: "টেবিল, কিচেন টিকিট, বাড়তি চিজের মতো অপশন।" },
    icon: "🍽️",
    features: ["restaurant", "loyalty", "accounting"],
    categories: ["meals", "fast_food", "snacks", "tea_coffee", "drinks", "desserts", "other"],
  },
  hardware: {
    name: { en: "Hardware & building supplies", bn: "হার্ডওয়্যার ও নির্মাণসামগ্রী" },
    pitch: { en: "Sell by feet, kg or piece; bundles and rolls.", bn: "ফুট, কেজি বা পিসে বিক্রি; বান্ডিল ও রোল।" },
    icon: "🔧",
    features: ["accounting"],
    categories: ["pipes", "electrical", "paint", "tools", "sanitary", "building", "fasteners", "other"],
  },
  electronics: {
    name: { en: "Electronics & mobile", bn: "ইলেকট্রনিক্স ও মোবাইল" },
    pitch: { en: "IMEI and serial numbers, warranty lookup.", bn: "আইএমইআই ও সিরিয়াল নম্বর, ওয়ারেন্টি যাচাই।" },
    icon: "📱",
    features: ["serials", "accounting"],
    categories: ["mobiles", "gadget_accessories", "computers", "appliances", "parts", "other"],
  },
  fashion: {
    name: { en: "Clothing & fashion", bn: "কাপড় ও ফ্যাশন" },
    pitch: { en: "Sizes and colours, fabric by the yard, points for regulars.", bn: "সাইজ ও রং, গজে থান কাপড়, নিয়মিত ক্রেতাদের পয়েন্ট।" },
    icon: "👗",
    features: ["loyalty", "accounting"],
    categories: ["mens", "womens", "kids", "footwear", "fabric", "fashion_accessories", "other"],
  },
  cosmetics: {
    name: { en: "Cosmetics & beauty", bn: "কসমেটিকস ও বিউটি" },
    pitch: { en: "Expiry dates, shades as variants, coupons.", bn: "মেয়াদের তারিখ, শেড অনুযায়ী ভ্যারিয়েন্ট, কুপন।" },
    icon: "💄",
    features: ["batches", "loyalty", "accounting"],
    categories: ["skin_care", "hair_care", "makeup", "fragrance", "personal_care", "other"],
  },
  stationery: {
    name: { en: "Stationery & books", bn: "স্টেশনারি ও বইয়ের দোকান" },
    pitch: { en: "Books, pens, photocopy charges on one bill.", bn: "বই, কলম, ফটোকপি — সব এক বিলে।" },
    icon: "📚",
    features: ["accounting"],
    categories: ["books", "notebooks", "pens", "office", "print_copy", "toys", "other"],
  },
  bakery: {
    name: { en: "Bakery & sweets", bn: "বেকারি ও মিষ্টির দোকান" },
    pitch: { en: "Sweets by the kg, best-before dates, regular customers.", bn: "কেজিতে মিষ্টি, মেয়াদের তারিখ, নিয়মিত ক্রেতা।" },
    icon: "🎂",
    features: ["batches", "loyalty", "accounting"],
    categories: ["bread", "cakes", "biscuits", "sweets", "snacks", "drinks", "other"],
  },
  general: {
    name: { en: "Other shop", bn: "অন্য ধরনের দোকান" },
    pitch: { en: "Start simple and switch on what you need.", bn: "সহজভাবে শুরু করুন, দরকারমতো ফিচার চালু করুন।" },
    icon: "🏪",
    features: ["loyalty", "accounting"],
    categories: ["staples", "snacks", "drinks", "home_care", "personal_care", "other"],
  },
};

export const FEATURE_LABELS: Record<Feature, { name: Text; help: Text }> = {
  batches: {
    name: { en: "Batches & expiry dates", bn: "ব্যাচ ও মেয়াদ" },
    help: { en: "Record batch numbers and expiry when goods arrive. Oldest stock sells first, with alerts before it expires.", bn: "মাল আসার সময় ব্যাচ নম্বর ও মেয়াদ লিখে রাখুন। আগের মেয়াদের মাল আগে বিক্রি হবে, মেয়াদ শেষের আগে সতর্ক করবে।" },
  },
  serials: {
    name: { en: "Serial numbers & warranty", bn: "সিরিয়াল নম্বর ও ওয়ারেন্টি" },
    help: { en: "Scan each phone's IMEI or each item's serial when buying and selling, and look up warranty later.", bn: "কেনা-বেচার সময় প্রতিটি ফোনের আইএমইআই বা পণ্যের সিরিয়াল স্ক্যান করুন, পরে ওয়ারেন্টি খুঁজে দেখুন।" },
  },
  restaurant: {
    name: { en: "Tables, kitchen tickets & extras", bn: "টেবিল, কিচেন টিকিট ও অপশন" },
    help: { en: "Keep orders open by table, send tickets to the kitchen, and add extras like extra cheese or less sugar.", bn: "টেবিল ধরে অর্ডার খোলা রাখুন, কিচেনে টিকিট পাঠান, বাড়তি চিজ বা কম চিনির মতো অপশন যোগ করুন।" },
  },
  loyalty: {
    name: { en: "Points, coupons & gift cards", bn: "পয়েন্ট, কুপন ও গিফট কার্ড" },
    help: { en: "Regular customers earn points on every bill. Run coupon offers and sell gift cards.", bn: "নিয়মিত ক্রেতারা প্রতিটি কেনাকাটায় পয়েন্ট পাবেন। কুপন অফার চালান, গিফট কার্ড বিক্রি করুন।" },
  },
  accounting: {
    name: { en: "Expenses & accounts", bn: "খরচ ও হিসাবপত্র" },
    help: { en: "Note rent, salaries and bills. See the cash book and real profit after expenses, and export it.", bn: "দোকানভাড়া, বেতন, বিল লিখে রাখুন। ক্যাশবুক আর খরচ বাদে আসল লাভ দেখুন, এক্সেলে নামিয়ে নিন।" },
  },
};

/** Before onboarding, or for a store that hasn't chosen, every category is offered. */
export const categoriesFor = (type: BusinessType | null | undefined): Category[] => (type ? BUSINESS_PROFILES[type].categories : [...CATEGORIES]);
export const categoryLabel = (c: string, lang: "en" | "bn") => (CATEGORY_LABELS as Record<string, Text>)[c]?.[lang] ?? c;
