import { z } from "zod";

/** Shared business rules, used by both the POS and the API. Money is always whole poisha. */

export const PAYMENT_METHODS = ["cash", "bkash", "nagad", "card", "baki"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Mobile wallets settle outside the POS, so the transaction ID is the only proof of payment. */
export const requiresPaymentRef = (m: PaymentMethod) => m === "bkash" || m === "nagad";

const poisha = z.number().int().nonnegative().max(100_000_000_000);

/** Quantities are whole thousandths, so 1 piece is 1000 and 1.25 kg is 1250. */
export const QTY_SCALE = 1000;
export const UNITS = ["pc", "kg", "litre", "metre"] as const;
export type Unit = (typeof UNITS)[number];
export const isLoose = (unit: Unit) => unit !== "pc";
const MAX_QTY = 100_000_000;
export const lineAmount = (qty: number, unitPricePoisha: number) => Math.round((qty * unitPricePoisha) / QTY_SCALE);

/** VAT inside a VAT-inclusive total. The rate is in hundredths of a percent, so 7.5% is 750. */
export const vatInTotal = (totalPoisha: number, rateBp: number) => Math.round((totalPoisha * rateBp) / (10_000 + rateBp));

export const saleLineSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).max(200),
  qty: z.number().int().positive().max(MAX_QTY),
  unitPricePoisha: poisha,
  unit: z.enum(UNITS).default("pc"),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export function computeTotals(
  lines: Pick<SaleLine, "qty" | "unitPricePoisha">[],
  discountPoisha: number,
) {
  const subtotalPoisha = lines.reduce((sum, l) => sum + lineAmount(l.qty, l.unitPricePoisha), 0);
  const discount = Math.min(Math.max(0, discountPoisha), subtotalPoisha);
  return { subtotalPoisha, discountPoisha: discount, totalPoisha: subtotalPoisha - discount };
}

export const saleSchema = z
  .object({
    id: z.string().uuid(),
    cashierId: z.string().uuid().nullable().default(null),
    customerId: z.string().uuid().nullable().default(null),
    deviceId: z.string().min(1).max(64),
    receiptNo: z.string().min(1).max(40),
    soldAt: z.string().datetime(),
    lines: z.array(saleLineSchema).min(1).max(500),
    discountPoisha: poisha,
    totalPoisha: poisha,
    paymentMethod: z.enum(PAYMENT_METHODS),
    tenderedPoisha: poisha,
    paymentRef: z.string().trim().min(1).max(64).nullable(),
    bakiPaidMethod: z.enum(["cash", "bkash", "nagad"]).default("cash"),
    vatRateBp: z.number().int().min(0).max(10_000).default(0),
    vatPoisha: poisha.default(0),
  })
  .superRefine((sale, ctx) => {
    if (sale.vatPoisha !== vatInTotal(sale.totalPoisha, sale.vatRateBp)) {
      ctx.addIssue({ code: "custom", path: ["vatPoisha"], message: "vat_mismatch" });
    }
    const totals = computeTotals(sale.lines, sale.discountPoisha);
    if (totals.discountPoisha !== sale.discountPoisha) {
      ctx.addIssue({ code: "custom", path: ["discountPoisha"], message: "discount_exceeds_subtotal" });
    }
    if (totals.totalPoisha !== sale.totalPoisha) {
      ctx.addIssue({ code: "custom", path: ["totalPoisha"], message: "total_mismatch" });
    }
    if (sale.paymentMethod === "baki") {
      if (!sale.customerId) ctx.addIssue({ code: "custom", path: ["customerId"], message: "customer_required" });
      if (sale.tenderedPoisha > sale.totalPoisha) ctx.addIssue({ code: "custom", path: ["tenderedPoisha"], message: "paid_exceeds_total" });
    } else if (sale.tenderedPoisha < sale.totalPoisha) {
      ctx.addIssue({ code: "custom", path: ["tenderedPoisha"], message: "underpaid" });
    }
    if (requiresPaymentRef(sale.paymentMethod) && !sale.paymentRef) {
      ctx.addIssue({ code: "custom", path: ["paymentRef"], message: "payment_ref_required" });
    }
  });
export type Sale = z.infer<typeof saleSchema>;

export const ROLES = ["owner", "manager", "cashier"] as const;
export type Role = (typeof ROLES)[number];

export const phoneSchema = z.string().trim().regex(/^01[3-9]\d{8}$/, "invalid_phone");

const isSimplePin = (pin: string) => {
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((v, i) => v - d[i]);
  return new Set(d).size === 1 || steps.every((s) => s === 1) || steps.every((s) => s === -1);
};
export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "invalid_pin")
  .refine((p) => !isSimplePin(p), "weak_pin");

const staffName = z.string().trim().min(1, "name_required").max(100);
const staffRole = z.enum(["manager", "cashier"]);
const phoneRule = { message: "phone_required", path: ["phone"] };
/** Managers and owners sign new devices in with a code sent to their phone. */
const hasPhoneIfManager = (s: { role: string; phone: string | null }) => s.role === "cashier" || s.phone !== null;

export const staffCreateSchema = z
  .object({ name: staffName, phone: phoneSchema.nullable(), role: staffRole, pin: pinSchema })
  .refine(hasPhoneIfManager, phoneRule);
export const staffUpdateSchema = z.object({
  name: staffName,
  phone: phoneSchema.nullable(),
  role: staffRole,
  pin: pinSchema.nullable(),
  disabled: z.boolean(),
});

export type StaffMember = { id: string; name: string; role: Role };
export type StaffRecord = StaffMember & { phone: string | null; disabled: boolean };
export type DeviceRecord = { id: string; name: string; lastSeenAt: string };
export type SignInResponse = { token: string; expiresAt: string; user: StaffMember };

export const CATEGORIES = ["staples", "oil_spice", "drinks", "snacks", "fresh", "home_care"] as const;

const productFields = z.object({
  nameEn: z.string().trim().max(200),
  nameBn: z.string().trim().max(200),
  category: z.enum(CATEGORIES),
  pricePoisha: poisha,
  costPoisha: poisha,
  barcode: z.string().trim().min(1).max(64).nullable(),
  unit: z.enum(UNITS),
});

const hasAName = (p: { nameEn: string; nameBn: string }) => p.nameEn.length > 0 || p.nameBn.length > 0;
const nameRule = { message: "name_required", path: ["nameBn"] };

const stockQty = z.number().int().min(-1_000_000_000).max(1_000_000_000);

export const productCreateSchema = productFields
  .extend({ openingStock: stockQty.nonnegative() })
  .refine(hasAName, nameRule);
export const productUpdateSchema = productFields
  .extend({ stockAdjustment: stockQty })
  .refine(hasAName, nameRule);
export type ProductCreate = z.infer<typeof productCreateSchema>;
export type ProductUpdate = z.infer<typeof productUpdateSchema>;

/** Editing details, including cost, which is kept out of the catalogue sent to every till. */
export type ProductDetails = ProductCreate & { id: string; sku: string; imageUrl: string | null };

export const SUPPLIER_PAYMENT_METHODS = ["cash", "bkash", "nagad", "bank"] as const;
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, "name_required").max(120),
  phone: phoneSchema.nullable(),
  address: z.string().trim().min(1).max(300).nullable(),
});

const paymentRefRule = (method: SupplierPaymentMethod, ref: string | null) => (method !== "bkash" && method !== "nagad") || ref !== null;
const paymentMethod = z.enum(SUPPLIER_PAYMENT_METHODS);
const paymentRef = z.string().trim().min(1).max(64).nullable();

export const purchaseLineSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().positive().max(MAX_QTY),
  unitCostPoisha: z.number().int().nonnegative().max(1_000_000_000),
});

const MAX_PURCHASE_POISHA = 10_000_000_000_000;

export const purchaseCreateSchema = z
  .object({
    id: z.string().uuid(),
    supplierId: z.string().uuid(),
    invoiceNo: z.string().trim().min(1).max(60).nullable(),
    purchasedAt: z.string().datetime(),
    discountPoisha: poisha,
    lines: z.array(purchaseLineSchema).min(1, "no_lines").max(500),
    receiveNow: z.boolean(),
    paidPoisha: poisha,
    paymentMethod,
    paymentRef,
  })
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: [] });
    const totals = computeTotals(p.lines.map((l) => ({ qty: l.qty, unitPricePoisha: l.unitCostPoisha })), p.discountPoisha);
    if (totals.subtotalPoisha > MAX_PURCHASE_POISHA) issue("total_too_large");
    if (p.discountPoisha > totals.subtotalPoisha) issue("discount_exceeds_subtotal");
    if (p.paidPoisha > totals.totalPoisha) issue("paid_exceeds_total");
    if (!p.receiveNow && p.paidPoisha > 0) issue("paid_before_receiving");
    if (p.paidPoisha > 0 && !paymentRefRule(p.paymentMethod, p.paymentRef)) issue("payment_ref_required");
    if (Date.parse(p.purchasedAt) > Date.now() + 24 * 60 * 60_000) issue("bad_date");
  });

export const purchaseReceiveSchema = z
  .object({ paidPoisha: poisha, paymentMethod, paymentRef })
  .refine((p) => p.paidPoisha === 0 || paymentRefRule(p.paymentMethod, p.paymentRef), "payment_ref_required");

export const supplierPaymentSchema = z
  .object({ id: z.string().uuid(), amountPoisha: poisha.positive(), method: paymentMethod, ref: paymentRef })
  .refine((p) => paymentRefRule(p.method, p.ref), "payment_ref_required");

export type SupplierSummary = { id: string; name: string; phone: string | null; address: string | null; duePoisha: number };
export type SupplierPaymentRecord = { id: string; amountPoisha: number; method: string; ref: string | null; paidAt: string };
export type SupplierDetail = { supplier: SupplierSummary; payments: SupplierPaymentRecord[] };
export type PurchaseStatus = "ordered" | "received" | "cancelled" | "voided";
export type PurchaseSummary = {
  id: string; supplierId: string; supplierName: string; invoiceNo: string | null; purchasedAt: string; status: PurchaseStatus; totalPoisha: number;
};
export type PurchaseDetail = PurchaseSummary & {
  discountPoisha: number;
  paidPoisha: number;
  lines: { lineNo: number; productId: string; nameEn: string; nameBn: string; imageUrl: string | null; qty: number; returnedQty: number; unitCostPoisha: number; unit: Unit }[];
};

export const customerInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "name_required").max(120),
  phone: phoneSchema.nullable(),
  address: z.string().trim().min(1).max(300).nullable(),
  creditLimitPoisha: poisha.nullable().default(null),
});

export const returnCreateSchema = z.object({
  id: z.string().uuid(),
  lines: z
    .array(z.object({ lineNo: z.number().int().positive(), qty: z.number().int().positive().max(MAX_QTY), restock: z.boolean() }))
    .min(1, "no_lines")
    .max(500)
    .refine((l) => new Set(l.map((x) => x.lineNo)).size === l.length, "duplicate_line"),
  refundMethod: z.enum(["cash", "bkash", "nagad", "card"]),
  refundRef: z.string().trim().min(1).max(64).nullable(),
});

/** What returned items are worth, after their share of any discount on the original bill. */
export function returnValue(qty: number, unitPricePoisha: number, subtotalPoisha: number, totalPoisha: number) {
  if (subtotalPoisha === 0) return 0;
  return Number((BigInt(qty) * BigInt(unitPricePoisha) * BigInt(totalPoisha)) / (BigInt(subtotalPoisha) * BigInt(QTY_SCALE)));
}

export const OP_KINDS = ["customer_create", "customer_payment", "sale_return", "shift_open", "shift_close"] as const;
export type OpKind = (typeof OP_KINDS)[number];
export const syncOpsSchema = z.object({
  ops: z.array(z.object({ id: z.string().uuid(), kind: z.enum(OP_KINDS), actorId: z.string().uuid(), payload: z.unknown() })).min(1).max(50),
});
export const opPaymentSchema = supplierPaymentSchema.and(z.object({ customerId: z.string().uuid() }));
export const opReturnSchema = returnCreateSchema.and(z.object({ saleId: z.string().uuid(), creditPoisha: poisha }));
export const shiftOpenSchema = z.object({ id: z.string().uuid(), openedAt: z.string().datetime(), floatPoisha: poisha });
export const shiftCloseSchema = z.object({ id: z.string().uuid(), closedAt: z.string().datetime(), expectedPoisha: z.number().int(), countedPoisha: poisha });

export type RecentSale = {
  id: string; receiptNo: string; soldAt: string; totalPoisha: number; tenderedPoisha: number; discountPoisha: number; vatPoisha: number; paymentMethod: string;
  bakiPaidMethod: string; customerId: string | null; cashierName: string | null; returnedPoisha: number; creditedPoisha: number;
  lines: { lineNo: number; productId: string; name: string; qty: number; unitPricePoisha: number; unit: Unit; returnedQty: number }[];
};

export const purchaseReturnSchema = z.object({
  id: z.string().uuid(),
  lines: z.array(z.object({ lineNo: z.number().int().positive(), qty: z.number().int().positive().max(MAX_QTY) })).min(1, "no_lines").max(500),
});

export type CustomerSummary = { id: string; name: string; phone: string | null; address: string | null; duePoisha: number; creditLimitPoisha: number | null };
export type CustomerDetail = {
  customer: CustomerSummary;
  sales: { id: string; receiptNo: string; soldAt: string; totalPoisha: number; paidPoisha: number }[];
  payments: SupplierPaymentRecord[];
};
export type SaleListItem = {
  id: string; receiptNo: string; soldAt: string; totalPoisha: number; paymentMethod: string;
  cashierName: string | null; customerName: string | null; returnedPoisha: number;
};
export type SaleDetail = {
  id: string; receiptNo: string; soldAt: string; discountPoisha: number; totalPoisha: number; tenderedPoisha: number; paymentMethod: string;
  lines: { lineNo: number; productId: string; name: string; nameEn: string; nameBn: string; imageUrl: string | null; qty: number; unitPricePoisha: number; returnedQty: number; unit: Unit }[];
};
export type ReturnResult = { valuePoisha: number; creditPoisha: number; refundPoisha: number };

export type ReportResponse = {
  netSalesPoisha: number; grossProfitPoisha: number; bills: number; discountPoisha: number; returnsPoisha: number; returnsCount: number;
  bakiGivenPoisha: number; bakiCollectedPoisha: number; cashMovementPoisha: number;
  daily: { date: string; netPoisha: number; bills: number }[];
  payments: { method: "cash" | "bkash" | "nagad" | "card"; receivedPoisha: number; refundedPoisha: number }[];
  topProducts: { id: string; nameEn: string; nameBn: string; imageUrl: string | null; qty: number; salesPoisha: number; unit: Unit }[];
  cashiers: { name: string; bills: number; salesPoisha: number }[];
  lowStock: { id: string; nameEn: string; nameBn: string; imageUrl: string | null; costPoisha: number; stock: number; unit: Unit }[];
  partial?: boolean;
  shifts?: { id: string; openedAt: string; closedAt: string | null; floatPoisha: number; expectedPoisha: number | null; countedPoisha: number | null; openedBy: string | null }[];
  vatPoisha: number; stockValuePoisha: number; bakiOutstandingPoisha: number; supplierOwedPoisha: number;
};

/** Placeholder prices: change them here before launch. */
export const PLANS = [
  { id: "starter", name: "Starter", monthlyPoisha: 49_900, maxDevices: 2 },
  { id: "growth", name: "Growth", monthlyPoisha: 99_900, maxDevices: 5 },
  { id: "pro", name: "Pro", monthlyPoisha: 199_900, maxDevices: 15 },
] as const;
export const planById = (id: string) => PLANS.find((p) => p.id === id);
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN = "growth";
export const GRACE_DAYS = 7;

export type SubscriptionInfo = { plan: string; accessUntil: string; onTrial: boolean };
export type SubscriptionStatus = "trial" | "active" | "grace" | "expired";

export function subscriptionState(sub: SubscriptionInfo, now = Date.now()): { status: SubscriptionStatus; daysLeft: number } {
  const until = Date.parse(sub.accessUntil);
  const daysLeft = Math.ceil((until - now) / 86_400_000);
  if (now <= until) return { status: sub.onTrial ? "trial" : "active", daysLeft };
  return { status: now <= until + GRACE_DAYS * 86_400_000 ? "grace" : "expired", daysLeft };
}

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "mail", "static", "cdn", "assets", "billing", "support", "help", "status", "blog", "ftp", "smtp", "root", "signup", "login", "lalcha"]);
export const subdomainSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, "invalid_subdomain")
  .refine((s) => !RESERVED_SUBDOMAINS.has(s), "reserved_subdomain");

export const signupSchema = z.object({
  storeName: z.string().trim().min(1, "name_required").max(100),
  subdomain: subdomainSchema,
  ownerName: z.string().trim().min(1, "name_required").max(100),
  phone: phoneSchema,
  pin: pinSchema,
  code: z.string().regex(/^\d{6}$/, "invalid_code"),
});

export const BILLING_METHODS = ["bkash", "nagad"] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];
export const billingPaymentSchema = z.object({
  id: z.string().uuid(),
  plan: z.string().max(20),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  method: z.enum(BILLING_METHODS),
  ref: z.string().trim().min(4).max(64),
});

export type BillingResponse = {
  subscription: SubscriptionInfo | null;
  payTo: Record<BillingMethod, string> | null;
  payments: { id: string; plan: string; months: number; amountPoisha: number; method: BillingMethod; ref: string; status: "pending" | "approved" | "rejected"; createdAt: string }[];
};
export type PlatformStore = { id: string; name: string; subdomain: string; plan: string; owner: string | null; phone: string | null; accessUntil: string | null; status: SubscriptionStatus };
export type PlatformPayment = {
  id: string; storeId: string; storeName: string; subdomain: string; plan: string; months: number; amountPoisha: number; method: string; ref: string; status: string; createdAt: string;
};

export const MAX_IMAGE_BYTES = 1024 * 1024;

export const syncRequestSchema =z.object({ sales: z.array(z.unknown()).min(1).max(100) });

export type SyncResult = { id: string | null; status: "accepted" | "rejected"; reason?: string };

export type CatalogProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  nameEn: string;
  nameBn: string;
  category: string;
  pricePoisha: number;
  imageUrl: string | null;
  stock: number;
  unit: Unit;
};

export const storeSettingsSchema = z.object({
  vatEnabled: z.boolean(),
  vatRateBp: z.number().int().min(0).max(10_000),
  bin: z.string().trim().max(30).nullable(),
  address: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(30).nullable(),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
export const DEFAULT_SETTINGS: StoreSettings = { vatEnabled: false, vatRateBp: 0, bin: null, address: null, phone: null };

export type CatalogResponse = {
  store: { name: string };
  products: CatalogProduct[];
  subscription: SubscriptionInfo | null;
  settings: StoreSettings;
};

export type Lang = "en" | "bn";

const numberFormat = {
  en: new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }),
  bn: new Intl.NumberFormat("bn-BD", { maximumFractionDigits: 2 }),
};

export const formatNumber = (n: number, lang: Lang) => numberFormat[lang].format(n);

const qtyFormat = {
  en: new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }),
  bn: new Intl.NumberFormat("bn-BD", { maximumFractionDigits: 3 }),
};
const UNIT_LABELS: Record<Unit, Record<Lang, string>> = {
  pc: { en: "", bn: "" },
  kg: { en: "kg", bn: "কেজি" },
  litre: { en: "L", bn: "লিটার" },
  metre: { en: "m", bn: "মিটার" },
};
export const unitLabel = (unit: Unit, lang: Lang) => UNIT_LABELS[unit][lang];
export const formatQty = (qty: number, unit: Unit, lang: Lang) => `${qtyFormat[lang].format(qty / QTY_SCALE)}${unit === "pc" ? "" : ` ${UNIT_LABELS[unit][lang]}`}`;
export const formatTaka = (p: number, lang: Lang) => `৳${formatNumber(p / 100, lang)}`;
