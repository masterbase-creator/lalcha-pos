import { sql } from "drizzle-orm";
import {
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
});

export const users = pgTable(
  "users",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone"),
    role: text("role", { enum: ["owner", "manager", "cashier"] }).notNull(),
    pinHash: text("pin_hash").notNull(),
    pinFailed: integer("pin_failed").notNull().default(0),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.id] }), uniqueIndex("users_store_phone").on(t.storeId, t.phone)],
);

export const loginCodes = pgTable(
  "login_codes",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.phone] })],
);

export const devices = pgTable(
  "devices",
  {
    storeId: uuid("store_id").notNull().references(() => stores.id),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    pairedBy: uuid("paired_by").notNull(),
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
    unit: text("unit", { enum: ["pc", "kg", "litre", "metre"] }).notNull().default("pc"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    uniqueIndex("products_store_sku").on(t.storeId, t.sku),
    uniqueIndex("products_store_barcode").on(t.storeId, t.barcode),
  ],
);

/** Append-only: current stock is always the sum of a product's entries. */
export const stockLedger = pgTable(
  "stock_ledger",
  {
    storeId: storeId(),
    id: uuid("id").notNull().defaultRandom(),
    productId: uuid("product_id").notNull(),
    qtyDelta: integer("qty_delta").notNull(),
    reason: text("reason", { enum: ["opening", "sale", "purchase", "return", "adjustment", "purchase_return", "purchase_void"] }).notNull(),
    refId: uuid("ref_id"),
    actorId: uuid("actor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
    foreignKey({ columns: [t.storeId, t.actorId], foreignColumns: [users.storeId, users.id] }),
    index("stock_ledger_product").on(t.storeId, t.productId),
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
    vatPoisha: bigint("vat_poisha", { mode: "number" }).notNull().default(0),
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
    invoiceNo: text("invoice_no"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["ordered", "received", "cancelled", "voided"] }).notNull(),
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
  phone: text("phone").primaryKey(),
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
    method: text("method", { enum: ["bkash", "nagad"] }).notNull(),
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
  bin: text("bin"),
  address: text("address"),
  phone: text("phone"),
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
