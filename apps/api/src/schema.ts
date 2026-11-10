import { UNITS } from "@lalcha/domain";
import { sql } from "drizzle-orm";
import {
  date,
  jsonb,
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const poisha = (name: string) => bigint(name, { mode: "number" }).notNull();

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  subdomain: text("subdomain").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  supportNote: text("support_note"),
});

export const branches = pgTable(
  "branches",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] })],
);

export const users = pgTable(
  "users",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    role: text("role", { enum: ["owner", "manager", "cashier"] }).notNull(),
    pinHash: text("pin_hash").notNull(),
    pinFailed: integer("pin_failed").notNull().default(0),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), uniqueIndex("users_store_phone").on(t.storeId, t.phone), uniqueIndex("users_store_email").on(t.storeId, t.email)],
);

/** One-time codes for connecting a device. "contact" is an email address, or a phone number once SMS is set up. */
export const loginCodes = pgTable(
  "login_codes",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    contact: text("contact").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.contact] })],
);

export const devices = pgTable(
  "devices",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    pairedBy: uuid("paired_by").notNull(),
    branchId: uuid("branch_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    uniqueIndex("devices_store_token").on(t.storeId, t.tokenHash),
    foreignKey({ columns: [t.storeId, t.pairedBy], foreignColumns: [users.storeId, users.id] }),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.tokenHash] }),
    foreignKey({ columns: [t.storeId, t.userId], foreignColumns: [users.storeId, users.id] }),
    foreignKey({ columns: [t.storeId, t.deviceId], foreignColumns: [devices.storeId, devices.id] }),
  ],
);

const storeId = () =>
  uuid("store_id")
    .notNull()
    .references(() => stores.id);

export const products = pgTable(
  "products",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    nameEn: text("name_en").notNull(),
    nameBn: text("name_bn").notNull(),
    category: text("category").notNull(),
    pricePoisha: poisha("price_poisha"),
    costPoisha: poisha("cost_poisha"),
    imageUrl: text("image_url"),
    unit: text("unit", { enum: UNITS }).notNull().default("pc"),
    vatRateBp: integer("vat_rate_bp"),
    /** Set on a variant: the main product it is listed under. Each variant keeps its own stock. */
    variantOf: uuid("variant_of"),
    variantName: text("variant_name"),
    /** "batch" follows batch numbers and expiry dates; "serial" follows one IMEI or serial per piece. */
    tracking: text("tracking", { enum: ["none", "batch", "serial"] }).notNull().default("none"),
    warrantyMonths: integer("warranty_months"),
    genericName: text("generic_name"),
    /** Extras offered at the till: [{ id, name, pricePoisha }]. */
    modifiers: jsonb("modifiers").$type<{ id: string; name: string; pricePoisha: number }[]>().notNull().default([]),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    uniqueIndex("products_store_sku").on(t.storeId, t.sku),
    uniqueIndex("products_store_barcode").on(t.storeId, t.barcode),
  ],
);

/** Other ways to sell a product's stock: a pack of 12, a 50 kg sack. Selling one takes "qty" of the product's own unit. */
export const productPacks = pgTable(
  "product_packs",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    qty: integer("qty").notNull(),
    pricePoisha: poisha("price_poisha"),
    barcode: text("barcode"),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
    uniqueIndex("product_packs_store_barcode").on(t.storeId, t.barcode),
  ],
);

/** Append-only: current stock is always the sum of a product's entries. */
export const stockLedger = pgTable(
  "stock_ledger",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    productId: uuid("product_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    qtyDelta: integer("qty_delta").notNull(),
    reason: text("reason", { enum: ["opening", "sale", "purchase", "return", "adjustment", "purchase_return", "purchase_void", "transfer_out", "transfer_in", "transfer_cancel", "write_off"] }).notNull(),
    refId: uuid("ref_id"),
    /** Which batch the stock came from or went into, for batch-tracked products. */
    batchId: uuid("batch_id"),
    actorId: uuid("actor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
    foreignKey({ columns: [t.storeId, t.actorId], foreignColumns: [users.storeId, users.id] }),
    foreignKey({ columns: [t.storeId, t.branchId], foreignColumns: [branches.storeId, branches.id] }),
    index("stock_ledger_product").on(t.storeId, t.productId, t.branchId),
  ],
);

export const customers = pgTable(
  "customers",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    creditLimitPoisha: bigint("credit_limit_poisha", { mode: "number" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    uniqueIndex("customers_store_phone").on(t.storeId, t.phone),
    index("customers_store_name").on(t.storeId, t.name),
  ],
);

export const sales = pgTable(
  "sales",
  {
    storeId: storeId(),
    /** Created on the device, which makes a retried upload harmless. */
    id: uuid("id").notNull(),
    cashierId: uuid("cashier_id"),
    customerId: uuid("customer_id"),
    branchId: uuid("branch_id").notNull(),
    deviceId: text("device_id").notNull(),
    receiptNo: text("receipt_no").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    discountPoisha: poisha("discount_poisha"),
    totalPoisha: poisha("total_poisha"),
    paymentMethod: text("payment_method").notNull(),
    tenderedPoisha: poisha("tendered_poisha"),
    paymentRef: text("payment_ref"),
    bakiPaidMethod: text("baki_paid_method").notNull().default("cash"),
    vatRateBp: integer("vat_rate_bp").notNull().default(0),
    vatInclusive: boolean("vat_inclusive").notNull().default(true),
    vatPoisha: bigint("vat_poisha", { mode: "number" }).notNull().default(0),
    /** Settled with loyalty points and gift cards. The payment method covers the rest. */
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    pointsPoisha: bigint("points_poisha", { mode: "number" }).notNull().default(0),
    giftCardCode: text("gift_card_code"),
    giftCardPoisha: bigint("gift_card_poisha", { mode: "number" }).notNull().default(0),
    couponCode: text("coupon_code"),
    tableName: text("table_name"),
    orderType: text("order_type"),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.cashierId], foreignColumns: [users.storeId, users.id] }),
    foreignKey({ columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }),
    index("sales_store_customer").on(t.storeId, t.customerId),
    index("sales_store_sold_at").on(t.storeId, t.soldAt),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    storeId: storeId(),
    saleId: uuid("sale_id").notNull(),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    qty: integer("qty").notNull(),
    unitPricePoisha: poisha("unit_price_poisha"),
    /** The average cost when sold, so later price changes don't rewrite past profit. */
    costPoisha: bigint("cost_poisha", { mode: "number" }).notNull().default(0),
    vatRateBp: integer("vat_rate_bp").notNull().default(0),
    vatPoisha: bigint("vat_poisha", { mode: "number" }).notNull().default(0),
    /** This line's share of the bill after discount and VAT, which is what a return refunds. */
    finalPoisha: bigint("final_poisha", { mode: "number" }).notNull().default(0),
    /** How much of the product's own unit one sold item used: 12000 for a dozen eggs. 1000 when sold by its own unit. */
    packQty: integer("pack_qty").notNull().default(1000),
    packName: text("pack_name"),
    /** Extras and kitchen notes chosen at the till. */
    note: text("note"),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.saleId, t.lineNo] }),
    foreignKey({ columns: [t.storeId, t.saleId], foreignColumns: [sales.storeId, sales.id] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), index("suppliers_store_name").on(t.storeId, t.name)],
);

export const purchases = pgTable(
  "purchases",
  {
    storeId: storeId(),
    /** Created on the device, which makes a retried save harmless. */
    id: uuid("id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    receivedValuePoisha: bigint("received_value_poisha", { mode: "number" }).notNull().default(0),
    invoiceNo: text("invoice_no"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["ordered", "partial", "received", "cancelled", "voided"] }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    discountPoisha: poisha("discount_poisha"),
    totalPoisha: poisha("total_poisha"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.supplierId], foreignColumns: [suppliers.storeId, suppliers.id] }),
    foreignKey({ columns: [t.storeId, t.createdBy], foreignColumns: [users.storeId, users.id] }),
    uniqueIndex("purchases_supplier_invoice").on(t.storeId, t.supplierId, t.invoiceNo).where(sql`status not in ('cancelled', 'voided')`),
    index("purchases_store_date").on(t.storeId, t.purchasedAt),
  ],
);

export const purchaseLines = pgTable(
  "purchase_lines",
  {
    storeId: storeId(),
    purchaseId: uuid("purchase_id").notNull(),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull(),
    qty: integer("qty").notNull(),
    receivedQty: integer("received_qty").notNull().default(0),
    unitCostPoisha: poisha("unit_cost_poisha"),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.purchaseId, t.lineNo] }),
    foreignKey({ columns: [t.storeId, t.purchaseId], foreignColumns: [purchases.storeId, purchases.id] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
  ],
);

/** Append-only: a supplier's due is always billed goods minus these payments. */
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    purchaseId: uuid("purchase_id"),
    amountPoisha: poisha("amount_poisha"),
    method: text("method").notNull(),
    ref: text("ref"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.supplierId], foreignColumns: [suppliers.storeId, suppliers.id] }),
    foreignKey({ columns: [t.storeId, t.purchaseId], foreignColumns: [purchases.storeId, purchases.id] }),
    foreignKey({ columns: [t.storeId, t.createdBy], foreignColumns: [users.storeId, users.id] }),
    index("supplier_payments_supplier").on(t.storeId, t.supplierId),
  ],
);

/** Append-only: collections reduce what a customer owes. */
export const customerPayments = pgTable(
  "customer_payments",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    customerId: uuid("customer_id").notNull(),
    amountPoisha: poisha("amount_poisha"),
    method: text("method").notNull(),
    ref: text("ref"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }),
    foreignKey({ columns: [t.storeId, t.createdBy], foreignColumns: [users.storeId, users.id] }),
    index("customer_payments_customer").on(t.storeId, t.customerId),
  ],
);

export const saleReturns = pgTable(
  "sale_returns",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    saleId: uuid("sale_id").notNull(),
    customerId: uuid("customer_id"),
    valuePoisha: poisha("value_poisha"),
    creditPoisha: poisha("credit_poisha"),
    refundPoisha: poisha("refund_poisha"),
    refundMethod: text("refund_method").notNull(),
    refundRef: text("refund_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.saleId], foreignColumns: [sales.storeId, sales.id] }),
    foreignKey({ columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }),
    foreignKey({ columns: [t.storeId, t.createdBy], foreignColumns: [users.storeId, users.id] }),
    index("sale_returns_sale").on(t.storeId, t.saleId),
    index("sale_returns_store_date").on(t.storeId, t.createdAt),
  ],
);

export const saleReturnLines = pgTable(
  "sale_return_lines",
  {
    storeId: storeId(),
    returnId: uuid("return_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    lineNo: integer("line_no").notNull(),
    qty: integer("qty").notNull(),
    valuePoisha: poisha("value_poisha"),
    costPoisha: poisha("cost_poisha"),
    restocked: boolean("restocked").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.returnId, t.lineNo] }),
    foreignKey({ columns: [t.storeId, t.returnId], foreignColumns: [saleReturns.storeId, saleReturns.id] }),
    foreignKey({ columns: [t.storeId, t.saleId, t.lineNo], foreignColumns: [saleLines.storeId, saleLines.saleId, saleLines.lineNo] }),
  ],
);

/** Not tied to a store: the store doesn't exist until signup finishes. */
export const signupCodes = pgTable("signup_codes", {
  contact: text("contact").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  storeId: uuid("store_id").primaryKey().references(() => stores.id),
  plan: text("plan").notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
  paidUntil: timestamp("paid_until", { withTimezone: true }),
});

export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    plan: text("plan").notNull(),
    months: integer("months").notNull(),
    amountPoisha: poisha("amount_poisha"),
    method: text("method", { enum: ["bkash", "nagad", "cash", "bank", "other"] }).notNull(),
    ref: text("ref").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.createdBy], foreignColumns: [users.storeId, users.id] }),
    // One transaction can't pay for two subscriptions. A rejected ID can be corrected and sent again.
    uniqueIndex("subscription_payments_ref").on(t.method, t.ref).where(sql`status <> 'rejected'`),
  ],
);

export const storeSettings = pgTable("store_settings", {
  storeId: uuid("store_id").primaryKey().references(() => stores.id),
  vatEnabled: boolean("vat_enabled").notNull().default(false),
  vatRateBp: integer("vat_rate_bp").notNull().default(0),
  vatInclusive: boolean("vat_inclusive").notNull().default(true),
  scaleEnabled: boolean("scale_enabled").notNull().default(false),
  scalePrefix: text("scale_prefix").notNull().default("21"),
  scaleMode: text("scale_mode", { enum: ["weight", "price"] }).notNull().default("weight"),
  bin: text("bin"),
  address: text("address"),
  phone: text("phone"),
  businessType: text("business_type", { enum: ["grocery", "general_store", "pharmacy", "restaurant", "tea_stall", "hardware", "furniture", "electronics", "auto_parts", "fashion", "jewellery", "cosmetics", "optical", "stationery", "bakery", "agro", "wholesale", "general"] }),
  features: jsonb("features").$type<("batches" | "serials" | "restaurant" | "loyalty" | "accounting")[]>().notNull().default([]),
  loyaltyEarnPoisha: integer("loyalty_earn_poisha").notNull().default(10000),
  loyaltyPointPoisha: integer("loyalty_point_poisha").notNull().default(100),
  receiptPrinter: text("receipt_printer", { enum: ["browser", "direct"] }).notNull().default("browser"),
  paperWidth: integer("paper_width").$type<58 | 80>().notNull().default(80),
  cashDrawer: boolean("cash_drawer").notNull().default(false),
  kitchenTickets: boolean("kitchen_tickets").notNull().default(false),
  expiryAlertDays: integer("expiry_alert_days").notNull().default(60),
  /** False until the owner has picked the shop type and features once. */
  onboarded: boolean("onboarded").notNull().default(false),
});

export const purchaseReturns = pgTable(
  "purchase_returns",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    valuePoisha: poisha("value_poisha"),
    creditPoisha: poisha("credit_poisha"),
    cashBackPoisha: poisha("cash_back_poisha"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.purchaseId], foreignColumns: [purchases.storeId, purchases.id] }),
    foreignKey({ columns: [t.storeId, t.supplierId], foreignColumns: [suppliers.storeId, suppliers.id] }),
    index("purchase_returns_purchase").on(t.storeId, t.purchaseId),
  ],
);

export const purchaseReturnLines = pgTable(
  "purchase_return_lines",
  {
    storeId: storeId(),
    returnId: uuid("return_id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    lineNo: integer("line_no").notNull(),
    qty: integer("qty").notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.returnId, t.lineNo] })],
);

export const shifts = pgTable(
  "shifts",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    openedBy: uuid("opened_by").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    floatPoisha: poisha("float_poisha"),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    expectedPoisha: bigint("expected_poisha", { mode: "number" }),
    countedPoisha: bigint("counted_poisha", { mode: "number" }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.openedBy], foreignColumns: [users.storeId, users.id] }),
    index("shifts_store_opened").on(t.storeId, t.openedAt),
  ],
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] })],
);

export const stockTransfers = pgTable(
  "stock_transfers",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    fromBranchId: uuid("from_branch_id").notNull(),
    toBranchId: uuid("to_branch_id").notNull(),
    status: text("status", { enum: ["sent", "received", "cancelled"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.fromBranchId], foreignColumns: [branches.storeId, branches.id] }),
    foreignKey({ columns: [t.storeId, t.toBranchId], foreignColumns: [branches.storeId, branches.id] }),
    index("stock_transfers_store_date").on(t.storeId, t.createdAt),
  ],
);

export const stockTransferLines = pgTable(
  "stock_transfer_lines",
  {
    storeId: storeId(),
    transferId: uuid("transfer_id").notNull(),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull(),
    qty: integer("qty").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.transferId, t.lineNo] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
  ],
);

/** Append-only: the store's record of who did what. */
export const auditLog = pgTable(
  "audit_log",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), index("audit_log_store_at").on(t.storeId, t.at)],
);

/** Your team's actions on customer stores. */
export const platformAudit = pgTable("platform_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id"),
  /** Which superadmin did it. */
  actor: text("actor"),
  action: text("action").notNull(),
  detail: text("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time sign-in codes for the superadmin panel, sent only to emails listed in PLATFORM_ADMIN_EMAILS. */
export const platformCodes = pgTable("platform_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
});

export const platformSessions = pgTable("platform_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/**
 * The company inbox: mail to @lalcha.com arrives from Postal, and replies sent from the superadmin
 * panel are kept beside it, so a conversation reads in order.
 */
export const platformMail = pgTable(
  "platform_mail",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    /** The @lalcha.com address involved: where it arrived, or what it was sent from. */
    mailbox: text("mailbox").notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull().default(""),
    textBody: text("text_body").notNull().default(""),
    htmlBody: text("html_body"),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    references: text("references"),
    attachments: text("attachments"),
    /** Postal's own message ID, so a webhook retried by Postal isn't stored twice. */
    postalId: text("postal_id"),
    sentBy: text("sent_by"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_mail_postal_id").on(t.postalId), index("platform_mail_created").on(t.createdAt)],
);

/** A batch of a product at one branch: its number and expiry date. Its stock is the ledger entries that name it. */
export const stockBatches = pgTable(
  "stock_batches",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    productId: uuid("product_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    batchNo: text("batch_no").notNull(),
    expiresOn: date("expires_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
    uniqueIndex("stock_batches_unique").on(t.storeId, t.productId, t.branchId, t.batchNo, sql`coalesce(${t.expiresOn}, '9999-12-31')`),
    index("stock_batches_expiry").on(t.storeId, t.expiresOn),
  ],
);

/** One row per serial-tracked piece (a phone's IMEI): where it is and who bought it. */
export const productSerials = pgTable(
  "product_serials",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    productId: uuid("product_id").notNull(),
    serial: text("serial").notNull(),
    branchId: uuid("branch_id").notNull(),
    status: text("status", { enum: ["in_stock", "sold", "returned"] }).notNull(),
    purchaseId: uuid("purchase_id"),
    saleId: uuid("sale_id"),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
    uniqueIndex("product_serials_unique").on(t.storeId, t.productId, t.serial),
    index("product_serials_serial").on(t.storeId, t.serial),
  ],
);

export const restaurantTables = pgTable(
  "restaurant_tables",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    area: text("area"),
    seats: integer("seats"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] })],
);

/** Append-only: a customer's points are the sum of their entries. */
export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    customerId: uuid("customer_id").notNull(),
    points: integer("points").notNull(),
    reason: text("reason", { enum: ["earn", "redeem", "adjust", "return"] }).notNull(),
    refId: uuid("ref_id"),
    note: text("note"),
    actorId: uuid("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }),
    index("loyalty_ledger_customer").on(t.storeId, t.customerId),
  ],
);

export const coupons = pgTable(
  "coupons",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    code: text("code").notNull(),
    kind: text("kind", { enum: ["percent", "fixed"] }).notNull(),
    value: integer("value").notNull(),
    minSpendPoisha: bigint("min_spend_poisha", { mode: "number" }).notNull().default(0),
    maxDiscountPoisha: bigint("max_discount_poisha", { mode: "number" }),
    validUntil: date("valid_until", { mode: "string" }),
    maxUses: integer("max_uses"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), uniqueIndex("coupons_store_code").on(t.storeId, t.code)],
);

export const giftCards = pgTable(
  "gift_cards",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    code: text("code").notNull(),
    initialPoisha: poisha("initial_poisha"),
    customerId: uuid("customer_id"),
    expiresOn: date("expires_on", { mode: "string" }),
    soldMethod: text("sold_method").notNull(),
    soldRef: text("sold_ref"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), uniqueIndex("gift_cards_store_code").on(t.storeId, t.code)],
);

/** Append-only: a card's balance is its first load plus these entries (spending is negative). */
export const giftCardLedger = pgTable(
  "gift_card_ledger",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    giftCardId: uuid("gift_card_id").notNull(),
    amountPoisha: bigint("amount_poisha", { mode: "number" }).notNull(),
    saleId: uuid("sale_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), index("gift_card_ledger_card").on(t.storeId, t.giftCardId)],
);

export const expenses = pgTable(
  "expenses",
  {
    storeId: storeId(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    category: text("category").notNull(),
    amountPoisha: poisha("amount_poisha"),
    method: text("method").notNull(),
    ref: text("ref"),
    note: text("note"),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), index("expenses_store_date").on(t.storeId, t.spentOn)],
);
