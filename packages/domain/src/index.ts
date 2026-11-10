import { z } from "zod";

/** Shared business rules, used by both the POS and the API. Money is always whole poisha. */

export const PAYMENT_METHODS = ["cash", "bkash", "nagad", "card", "baki"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Mobile wallets settle outside the POS, so the transaction ID is the only proof of payment. */
export const requiresPaymentRef = (m: PaymentMethod) => m === "bkash" || m === "nagad";

const poisha = z.number().int().nonnegative().max(100_000_000_000);

/** Quantities are whole thousandths, so 1 piece is 1000 and 1.25 kg is 1250. */
export const QTY_SCALE = 1000;
/** How a product is counted. Measured units can be sold in fractions (1.25 kg); counted ones only whole. */
export const UNITS = ["pc", "kg", "gram", "litre", "ml", "metre", "feet", "yard", "sqft", "dozen", "hali", "box", "pack", "bag"] as const;
export type Unit = (typeof UNITS)[number];
export const MEASURED_UNITS: readonly Unit[] = ["kg", "gram", "litre", "ml", "metre", "feet", "yard", "sqft"];
export const isLoose = (unit: Unit) => MEASURED_UNITS.includes(unit);
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
  vatRateBp: z.number().int().min(0).max(10_000).default(0),
  /** For a pack (a dozen, a sack): how much of the product's own unit one sold pack uses, in thousandths. */
  packQty: z.number().int().positive().max(MAX_QTY).default(QTY_SCALE),
  packName: z.string().trim().max(40).nullable().default(null),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

/**
 * The full bill: spreads the discount across lines, then applies each line's own VAT rate.
 * The per-line result is what a later return refunds, so mixed rates stay exact.
 */
export function computeBill(lines: { qty: number; unitPricePoisha: number; vatRateBp?: number }[], discountPoisha: number, vatInclusive: boolean) {
  const amounts = lines.map((l) => lineAmount(l.qty, l.unitPricePoisha));
  const subtotalPoisha = amounts.reduce((a, b) => a + b, 0);
  const discount = Math.min(Math.max(0, discountPoisha), subtotalPoisha);
  let left = discount;
  const result = amounts.map((amount, i) => {
    const share = i === amounts.length - 1 ? left : subtotalPoisha ? Math.min(left, Math.round((amount * discount) / subtotalPoisha)) : 0;
    left -= share;
    const net = amount - share;
    const rate = lines[i].vatRateBp ?? 0;
    const vatPoisha = vatInclusive ? vatInTotal(net, rate) : Math.round((net * rate) / 10_000);
    return { vatPoisha, finalPoisha: vatInclusive ? net : net + vatPoisha };
  });
  return {
    subtotalPoisha,
    discountPoisha: discount,
    vatPoisha: result.reduce((a, l) => a + l.vatPoisha, 0),
    totalPoisha: result.reduce((a, l) => a + l.finalPoisha, 0),
    lines: result,
  };
}

/** Standard EAN-13 check digit. */
function ean13Valid(code: string) {
  const sum = [...code.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

/** Reads a scale label: PP CCCCC VVVVV K, where V is grams or poisha depending on the scale's setup. */
export function parseScaleBarcode(code: string, prefix: string) {
  if (!/^\d{13}$/.test(code) || !code.startsWith(prefix) || !ean13Valid(code)) return null;
  return { itemCode: code.slice(2, 7), value: Number(code.slice(7, 12)) };
}

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
    vatInclusive: z.boolean().default(true),
    vatPoisha: poisha.default(0),
  })
  .superRefine((sale, ctx) => {
    const totals = computeBill(sale.lines, sale.discountPoisha, sale.vatInclusive);
    if (sale.vatPoisha !== totals.vatPoisha) {
      ctx.addIssue({ code: "custom", path: ["vatPoisha"], message: "vat_mismatch" });
    }
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
/** Login codes go to email first: free to send, and it works on every phone. */
export const emailSchema = z.string().trim().toLowerCase().max(254).email("invalid_email");

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
const contactRule = { message: "email_required", path: ["email"] };
/** Managers and owners connect new devices with a code sent to their email (or phone, once SMS is set up). */
export const hasContactIfManager = (s: { role: string; phone: string | null; email: string | null }) => s.role === "cashier" || s.email !== null || s.phone !== null;

export const staffCreateSchema = z
  .object({ name: staffName, email: emailSchema.nullable(), phone: phoneSchema.nullable(), role: staffRole, pin: pinSchema })
  .refine(hasContactIfManager, contactRule);
export const staffUpdateSchema = z.object({
  name: staffName,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  role: staffRole,
  pin: pinSchema.nullable(),
  disabled: z.boolean(),
});

export type StaffMember = { id: string; name: string; role: Role };
export type StaffRecord = StaffMember & { email: string | null; phone: string | null; disabled: boolean };
export type DeviceRecord = { id: string; name: string; lastSeenAt: string; branchId: string };
export type SignInResponse = { token: string; expiresAt: string; user: StaffMember };

export const CATEGORIES = ["staples", "oil_spice", "drinks", "snacks", "fresh", "home_care"] as const;

/** Another way to sell the same stock, e.g. "Dozen" = 12 pc, or "Sack" = 50 kg, at its own price. */
export const packSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "pack_name_required").max(40),
  qty: z.number().int().positive("pack_qty_required").max(MAX_QTY),
  pricePoisha: poisha,
  barcode: z.string().trim().min(1).max(64).nullable(),
});
export type Pack = z.infer<typeof packSchema>;

const productFields = z.object({
  nameEn: z.string().trim().max(200),
  nameBn: z.string().trim().max(200),
  category: z.enum(CATEGORIES),
  pricePoisha: poisha,
  costPoisha: poisha,
  barcode: z.string().trim().min(1).max(64).nullable(),
  unit: z.enum(UNITS, { message: "unit_required" }),
  vatRateBp: z.number().int().min(0).max(10_000).nullable().default(null),
  /** A variant (size, colour) is its own product with its own stock, shown under its main product. */
  variantOf: z.string().uuid().nullable().default(null),
  variantName: z.string().trim().max(60).nullable().default(null),
  packs: z.array(packSchema).max(10).default([]),
});

const hasAName = (p: { nameEn: string; nameBn: string }) => p.nameEn.length > 0 || p.nameBn.length > 0;
const nameRule = { message: "name_required", path: ["nameBn"] };

const stockQty = z.number().int().min(-1_000_000_000).max(1_000_000_000);

const variantNamed = (p: { variantOf: string | null; variantName: string | null }) => !p.variantOf || Boolean(p.variantName);
const variantRule = { message: "variant_name_required", path: ["variantName"] };

export const productCreateSchema = productFields
  .extend({ openingStock: stockQty.nonnegative() })
  .refine(hasAName, nameRule)
  .refine(variantNamed, variantRule);
export const productUpdateSchema = productFields
  .extend({ stockAdjustment: stockQty })
  .refine(hasAName, nameRule)
  .refine(variantNamed, variantRule);
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
    if (p.paidPoisha > 0 && !paymentRefRule(p.paymentMethod, p.paymentRef)) issue("payment_ref_required");
    if (Date.parse(p.purchasedAt) > Date.now() + 24 * 60 * 60_000) issue("bad_date");
  });

export const purchaseReceiveSchema = z
  .object({
    id: z.string().uuid(),
    /** Leave out to receive everything still outstanding. */
    lines: z.array(z.object({ lineNo: z.number().int().positive(), qty: z.number().int().positive().max(MAX_QTY) })).max(500).optional(),
    paidPoisha: poisha,
    paymentMethod,
    paymentRef,
  })
  .refine((p) => p.paidPoisha === 0 || paymentRefRule(p.paymentMethod, p.paymentRef), "payment_ref_required");

export const supplierPaymentSchema = z
  .object({ id: z.string().uuid(), amountPoisha: poisha.positive(), method: paymentMethod, ref: paymentRef })
  .refine((p) => paymentRefRule(p.method, p.ref), "payment_ref_required");

export type SupplierSummary = { id: string; name: string; phone: string | null; address: string | null; duePoisha: number };
export type SupplierPaymentRecord = { id: string; amountPoisha: number; method: string; ref: string | null; paidAt: string };
export type SupplierDetail = { supplier: SupplierSummary; payments: SupplierPaymentRecord[]; hasMore: boolean };
export type PurchaseStatus = "ordered" | "partial" | "received" | "cancelled" | "voided";
export type PurchaseSummary = {
  id: string; supplierId: string; supplierName: string; invoiceNo: string | null; purchasedAt: string; status: PurchaseStatus; totalPoisha: number;
};
export type PurchaseDetail = PurchaseSummary & {
  discountPoisha: number;
  paidPoisha: number;
  lines: { lineNo: number; productId: string; nameEn: string; nameBn: string; imageUrl: string | null; qty: number; receivedQty: number; returnedQty: number; unitCostPoisha: number; unit: Unit }[];
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

/** What returned items are worth: their share of what that line really cost after discount and VAT. */
export function returnValue(qty: number, soldQty: number, finalPoisha: number) {
  if (soldQty === 0) return 0;
  return Number((BigInt(qty) * BigInt(finalPoisha)) / BigInt(soldQty));
}

export const OP_KINDS = ["customer_create", "customer_update", "customer_payment", "sale_return", "shift_open", "shift_close"] as const;
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
  lines: { lineNo: number; productId: string; name: string; qty: number; unitPricePoisha: number; unit: Unit; returnedQty: number; finalPoisha: number }[];
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
  hasMore: boolean;
};
export type SaleListItem = {
  id: string; receiptNo: string; soldAt: string; totalPoisha: number; paymentMethod: string;
  cashierName: string | null; customerName: string | null; returnedPoisha: number;
};
export type SaleDetail = {
  id: string; receiptNo: string; soldAt: string; discountPoisha: number; totalPoisha: number; tenderedPoisha: number; paymentMethod: string;
  lines: { lineNo: number; productId: string; name: string; nameEn: string; nameBn: string; imageUrl: string | null; qty: number; unitPricePoisha: number; returnedQty: number; unit: Unit; finalPoisha: number }[];
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
  { id: "starter", name: "Starter", monthlyPoisha: 49_900, maxDevices: 2, maxBranches: 1, selfServe: true },
  { id: "growth", name: "Growth", monthlyPoisha: 99_900, maxDevices: 5, maxBranches: 3, selfServe: true },
  // No longer sold: bigger shops get an Enterprise deal. Kept so stores already on it keep their limits.
  { id: "pro", name: "Pro", monthlyPoisha: 199_900, maxDevices: 15, maxBranches: 10, selfServe: false },
] as const;
export const planById = (id: string) => PLANS.find((p) => p.id === id);
/** Plans an owner may pay for in the app: the ones on sale, plus renewing the plan they already have. */
export const buyablePlans = (currentPlan?: string | null) => PLANS.filter((p) => p.selfServe || p.id === currentPlan);
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN = "growth";
export const GRACE_DAYS = 7;

export type SubscriptionInfo = { plan: string; accessUntil: string; onTrial: boolean; suspended?: boolean };
export type SubscriptionStatus = "trial" | "active" | "grace" | "expired";

export function subscriptionState(sub: SubscriptionInfo, now = Date.now()): { status: SubscriptionStatus; daysLeft: number } {
  const until = Date.parse(sub.accessUntil);
  const daysLeft = Math.ceil((until - now) / 86_400_000);
  if (sub.suspended) return { status: "expired", daysLeft };
  if (now <= until) return { status: sub.onTrial ? "trial" : "active", daysLeft };
  return { status: now <= until + GRACE_DAYS * 86_400_000 ? "grace" : "expired", daysLeft };
}

const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "mail", "static", "cdn", "assets", "billing", "support", "help", "status", "blog", "ftp", "smtp", "root", "signup", "login", "lalcha", "demo",
  "pos", "postal", "imap", "pop", "webmail", "mx", "dev", "staging", "test", "docs",
  // Already used by other services on lalcha.com, so no store may take them.
  "auth", "authentik", "betaadvisory", "bridge", "carzlynch", "chat", "coolify", "coolifyrecent", "crm", "dcms", "dseblock", "dsemarketinsight", "erp", "fameit",
  "foxline", "hfc", "invoice", "matrix", "matter", "meet", "n8n", "project", "riot", "robi", "rocket", "turn", "zulip",
]);
export const subdomainSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, "invalid_subdomain")
  .refine((s) => !RESERVED_SUBDOMAINS.has(s), "reserved_subdomain");

export const signupSchema = z.object({
  storeName: z.string().trim().min(1, "name_required").max(100),
  subdomain: subdomainSchema,
  ownerName: z.string().trim().min(1, "name_required").max(100),
  email: emailSchema,
  phone: phoneSchema.nullable(),
  pin: pinSchema,
  code: z.string().regex(/^\d{6}$/, "invalid_code"),
});

export const BILLING_METHODS = ["bkash", "nagad"] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];
/** How a subscription was paid. Cash, bank and other are recorded by a superadmin, never by a store. */
export const SUBSCRIPTION_METHODS = ["bkash", "nagad", "cash", "bank", "other"] as const;
export type SubscriptionMethod = (typeof SUBSCRIPTION_METHODS)[number];
export const manualSubscriptionSchema = z.object({
  plan: z.string().max(20),
  months: z.number().int().min(1).max(36),
  method: z.enum(SUBSCRIPTION_METHODS),
  amountPoisha: z.number().int().nonnegative().max(1_000_000_000),
  ref: z.string().trim().max(64),
});
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
  payments: { id: string; plan: string; months: number; amountPoisha: number; method: SubscriptionMethod; ref: string; status: "pending" | "approved" | "rejected"; createdAt: string }[];
};
export type PlatformStore = {
  id: string; name: string; subdomain: string; plan: string; owner: string | null; phone: string | null; email: string | null; accessUntil: string | null; status: SubscriptionStatus;
  suspended: boolean; note: string | null; createdAt: string; devices: number; staff: number; salesLast30: number; lastSaleAt: string | null;
};
export type PlatformLog = { id: string; actor: string | null; action: string; storeName: string | null; detail: string | null; at: string };

export const branchInputSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1, "name_required").max(100), address: z.string().trim().min(1).max(300).nullable() });
export type BranchRecord = { id: string; name: string; address: string | null };
export const transferCreateSchema = z
  .object({
    id: z.string().uuid(),
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    lines: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive().max(MAX_QTY) })).min(1, "no_lines").max(500),
  })
  .refine((t) => t.fromBranchId !== t.toBranchId, "same_branch")
  .refine((t) => new Set(t.lines.map((l) => l.productId)).size === t.lines.length, "duplicate_line");
export type TransferRecord = {
  id: string; status: "sent" | "received" | "cancelled"; createdAt: string; fromBranchId: string; toBranchId: string; fromName: string; toName: string;
  lines: { productId: string; nameEn: string; nameBn: string; unit: Unit; qty: number }[];
};
export type AuditEntry = { id: string; action: string; entityId: string | null; detail: Record<string, unknown> | null; at: string; actorName: string | null };
export const importRowsSchema = z.object({ rows: z.array(z.unknown()).min(1).max(500) });
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
  vatRateBp: number | null;
  variantOf: string | null;
  variantName: string | null;
  packs: Pack[];
};

export const storeSettingsSchema = z.object({
  vatEnabled: z.boolean(),
  vatRateBp: z.number().int().min(0).max(10_000),
  vatInclusive: z.boolean().default(true),
  scaleEnabled: z.boolean().default(false),
  scalePrefix: z.string().regex(/^\d{2}$/).default("21"),
  scaleMode: z.enum(["weight", "price"]).default("weight"),
  bin: z.string().trim().max(30).nullable(),
  address: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(30).nullable(),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
export const DEFAULT_SETTINGS: StoreSettings = { vatEnabled: false, vatRateBp: 0, vatInclusive: true, scaleEnabled: false, scalePrefix: "21", scaleMode: "weight", bin: null, address: null, phone: null };

export type CatalogResponse = {
  store: { name: string };
  products: CatalogProduct[];
  subscription: SubscriptionInfo | null;
  settings: StoreSettings;
  branch: { id: string; name: string };
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
  gram: { en: "g", bn: "গ্রাম" },
  litre: { en: "L", bn: "লিটার" },
  ml: { en: "ml", bn: "মিলি" },
  metre: { en: "m", bn: "মিটার" },
  feet: { en: "ft", bn: "ফুট" },
  yard: { en: "yd", bn: "গজ" },
  sqft: { en: "sq ft", bn: "বর্গফুট" },
  dozen: { en: "dozen", bn: "ডজন" },
  hali: { en: "hali", bn: "হালি" },
  box: { en: "box", bn: "বক্স" },
  pack: { en: "pack", bn: "প্যাকেট" },
  bag: { en: "bag", bn: "বস্তা" },
};
/** The unit's full name, for choosing it in a form (pc has no short label on the till). */
export const UNIT_NAMES: Record<Unit, Record<Lang, string>> = {
  pc: { en: "Piece (pc)", bn: "পিস" },
  kg: { en: "Kilogram (kg)", bn: "কেজি" },
  gram: { en: "Gram (g)", bn: "গ্রাম" },
  litre: { en: "Litre (L)", bn: "লিটার" },
  ml: { en: "Millilitre (ml)", bn: "মিলিলিটার" },
  metre: { en: "Metre (m)", bn: "মিটার" },
  feet: { en: "Feet (ft)", bn: "ফুট" },
  yard: { en: "Yard (gaj)", bn: "গজ" },
  sqft: { en: "Square feet", bn: "বর্গফুট" },
  dozen: { en: "Dozen", bn: "ডজন" },
  hali: { en: "Hali (4)", bn: "হালি" },
  box: { en: "Box", bn: "বক্স" },
  pack: { en: "Packet", bn: "প্যাকেট" },
  bag: { en: "Bag / sack", bn: "বস্তা" },
};
export const unitLabel = (unit: Unit, lang: Lang) => UNIT_LABELS[unit][lang];
export const formatQty = (qty: number, unit: Unit, lang: Lang) => `${qtyFormat[lang].format(qty / QTY_SCALE)}${unit === "pc" ? "" : ` ${UNIT_LABELS[unit][lang]}`}`;
export const formatTaka = (p: number, lang: Lang) => `৳${formatNumber(p / 100, lang)}`;

/** The company inbox in the superadmin panel. */
export type PlatformMailSummary = {
  id: string; direction: "in" | "out"; mailbox: string; fromAddress: string; fromName: string | null; toAddress: string;
  subject: string; preview: string; read: boolean; createdAt: string;
};
export type PlatformMail = PlatformMailSummary & {
  textBody: string; htmlBody: string | null; messageId: string | null; inReplyTo: string | null; attachments: { filename: string; size: number }[]; sentBy: string | null;
};
export type MailboxInfo = { name: string; address: string; unread: number };
export const mailSendSchema = z.object({
  from: z.string().trim().toLowerCase().max(40),
  to: z.string().trim().toLowerCase().max(254).email("invalid_email"),
  subject: z.string().trim().min(1, "subject_required").max(300),
  text: z.string().trim().min(1, "message_required").max(50_000),
  /** The message being answered, so the reply threads in the customer's mail app. */
  replyTo: z.string().uuid().nullable().default(null),
});
