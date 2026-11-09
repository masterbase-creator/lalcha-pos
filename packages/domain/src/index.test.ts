import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTotals, formatQty, formatTaka, lineAmount, vatInTotal, pinSchema, productCreateSchema, purchaseCreateSchema, returnValue, saleSchema, subdomainSchema, subscriptionState } from "./index.ts";

test("purchase payments stay within the total", () => {
  const id = "0190a5e0-7b1c-7000-8000-000000000001";
  const p = {
    id, supplierId: id, invoiceNo: null, purchasedAt: "2026-11-09T06:00:00.000Z", discountPoisha: 100,
    lines: [{ productId: id, qty: 2000, unitCostPoisha: 1000 }], receiveNow: true, paidPoisha: 1900, paymentMethod: "cash", paymentRef: null,
  };
  assert.equal(purchaseCreateSchema.safeParse(p).success, true);
  assert.equal(purchaseCreateSchema.safeParse({ ...p, paidPoisha: 1901 }).success, false);
  assert.equal(purchaseCreateSchema.safeParse({ ...p, receiveNow: false }).success, false);
  assert.equal(purchaseCreateSchema.safeParse({ ...p, paymentMethod: "bkash" }).success, false);
});

test("subscription moves from active to grace to expired", () => {
  const sub = { plan: "growth", accessUntil: "2026-11-10T00:00:00.000Z", onTrial: false };
  const at = (d: string) => subscriptionState(sub, Date.parse(d)).status;
  assert.equal(at("2026-11-09T00:00:00.000Z"), "active");
  assert.equal(at("2026-11-12T00:00:00.000Z"), "grace");
  assert.equal(at("2026-11-18T00:00:00.000Z"), "expired");
});

test("store addresses are checked", () => {
  for (const s of ["ab", "-bad", "bad-", "UP", "has space", "admin"]) assert.equal(subdomainSchema.safeParse(s).success, false, s);
  assert.equal(subdomainSchema.safeParse("mita-store1").success, true);
});

test("loose quantities price and print correctly", () => {
  assert.equal(lineAmount(1250, 8000), 10000);
  assert.equal(formatQty(1250, "kg", "en"), "1.25 kg");
  assert.equal(formatQty(2000, "pc", "en"), "2");
});
test("VAT comes out of an inclusive total", () => assert.equal(vatInTotal(11500, 1500), 1500));

test("easy PINs are refused", () => {
  for (const pin of ["1111", "1234", "9876", "123", "1234567", "12a4"]) assert.equal(pinSchema.safeParse(pin).success, false, pin);
  assert.equal(pinSchema.safeParse("4826").success, true);
});

test("a product needs at least one name", () => {
  const p = { nameEn: "", nameBn: "", category: "fresh", pricePoisha: 100, costPoisha: 80, barcode: null, unit: "pc", openingStock: 0 };
  assert.equal(productCreateSchema.safeParse(p).success, false);
  assert.equal(productCreateSchema.safeParse({ ...p, nameBn: "আম" }).success, true);
  assert.equal(productCreateSchema.safeParse({ ...p, nameBn: "আম", openingStock: -1 }).success, false);
});

const base = {
  id: "0190a5e0-7b1c-7000-8000-000000000001",
  deviceId: "d1",
  receiptNo: "AB12-000001",
  soldAt: "2026-11-09T10:00:00.000Z",
  lines: [{ productId: "0190a5e0-7b1c-7000-8000-000000000002", name: "Rice", qty: 2000, unitPricePoisha: 41000 }],
  discountPoisha: 2000,
  totalPoisha: 80000,
  paymentMethod: "cash" as const,
  tenderedPoisha: 100000,
  paymentRef: null,
};

test("baki needs a customer and can be part-paid", () => {
  const b = { ...base, paymentMethod: "baki" as const, tenderedPoisha: 10000 };
  assert.equal(saleSchema.safeParse(b).success, false);
  const customerId = "0190a5e0-7b1c-7000-8000-000000000009";
  assert.equal(saleSchema.safeParse({ ...b, customerId }).success, true);
  assert.equal(saleSchema.safeParse({ ...b, customerId, tenderedPoisha: 999999 }).success, false);
});

test("returns share the bill discount", () => assert.equal(returnValue(1000, 1000, 2000, 1500), 750));

test("totals apply and cap the discount", () => {
  assert.equal(computeTotals(base.lines, 2000).totalPoisha, 80000);
  assert.equal(computeTotals(base.lines, 999999).totalPoisha, 0);
});

test("accepts a correct sale", () => assert.equal(saleSchema.safeParse(base).success, true));
test("rejects a tampered total", () => assert.equal(saleSchema.safeParse({ ...base, totalPoisha: 1 }).success, false));
test("rejects underpayment", () => assert.equal(saleSchema.safeParse({ ...base, tenderedPoisha: 1 }).success, false));
test("bKash needs a transaction ID", () => {
  assert.equal(saleSchema.safeParse({ ...base, paymentMethod: "bkash" }).success, false);
  assert.equal(saleSchema.safeParse({ ...base, paymentMethod: "bkash", paymentRef: "TX1" }).success, true);
});
test("formats Bangla digits", () => assert.equal(formatTaka(125050, "bn"), "৳১,২৫০.৫"));
