// One shop, start to finish: sign up, set the shop up, add products and staff, buy stock, sell for
// cash, bKash, baki and wholesale, collect baki, keep a table order open across tills, change the
// day's prices, take a return, write an expense and read the reports. Every step checks what a
// shopkeeper would see afterwards.
import { client, codeFrom, done, line, lineTotal, LIVE, ok, qty, sale, step, taka, today, uuid } from "./lib.mjs";

const stamp = Date.now().toString(36);
const subdomain = process.env.E2E_SUBDOMAIN ?? `e2e-${stamp}`;
const email = process.env.E2E_EMAIL ?? `owner-${stamp}@e2e.test`;
const PIN = process.env.E2E_PIN ?? "4826";
const site = client(null);
const till = client(subdomain);

step("1. Sign up and open the store");
const free = await site.get(`/v1/public/subdomain?name=${subdomain}&store=E2E`);
ok(free.available === true, `the address ${subdomain} is free`);
const taken = await site.get("/v1/public/subdomain?name=demo&store=Demo");
ok(taken.available === false && taken.suggestions.length > 0, "a taken address comes back with suggestions");
const asked = await site.post("/v1/public/signup/request-code", { email });
const code = await codeFrom(asked, `signup ${email}`);
await site.post("/v1/public/signup", { storeName: "E2E Test Shop", subdomain, ownerName: "E2E Owner", email, phone: null, pin: PIN, code: "000000", businessType: "grocery" }, 401);
ok(true, "a wrong code is refused");
const created = await site.post("/v1/public/signup", { storeName: "E2E Test Shop", subdomain, ownerName: "E2E Owner", email, phone: null, pin: PIN, code, businessType: "restaurant" }, 201);
ok(created.handoff, "signup returns a one-time link, so the owner isn't asked for a second code");
till.state.device = (await till.post("/v1/auth/handoff", { token: created.handoff, deviceName: "E2E counter 1" })).deviceToken;
ok(till.state.device, "this browser is connected as the first till");
await client(subdomain).post("/v1/auth/handoff", { token: created.handoff, deviceName: "copy" }, 401);
ok(true, "the one-time link can't connect a second device");
const owner = (await till.get("/v1/auth/staff")).staff[0];
await till.post("/v1/auth/pin", { userId: owner.id, pin: "9173" }, 401);
ok(true, "a wrong PIN is refused");
till.state.session = (await till.post("/v1/auth/pin", { userId: owner.id, pin: PIN })).token;
ok(till.state.session, "the owner signs in with the PIN");

step("2. Set the shop up");
const first = await till.get("/v1/catalog");
ok(first.settings.onboarded === false && first.settings.businessType === "restaurant", "a new store starts in onboarding with the chosen shop type");
ok(first.subscription && first.products.length === 0, "it starts on a free trial with no products");
await till.put("/v1/settings", { ...first.settings, features: ["restaurant", "loyalty", "accounting"], vatEnabled: false, vatRateBp: 0, bin: null, address: "১২ স্টেশন রোড, ঢাকা", phone: "01700000000", onboarded: true });
const tableId = uuid();
await till.post("/v1/tables", { id: tableId, name: "১", area: null, seats: 4 }, [200, 201]);
ok((await till.get("/v1/catalog")).tables.length === 1, "onboarding saved, and a table added");

step("3. Products");
const fields = { nameEn: "", nameBn: "", category: "staples", pricePoisha: 0, costPoisha: 0, barcode: null, unit: "pc" };
const mk = async (extra) => (await till.post("/v1/products", { ...fields, ...extra }, [200, 201])).id;
const riceId = await mk({ nameEn: "Rice 5kg", nameBn: "চাল ৫ কেজি", pricePoisha: taka(410), costPoisha: taka(370), wholesalePricePoisha: taka(395), openingStock: qty(20), barcode: `E2E${stamp}1` });
const onionId = await mk({ nameEn: "Onion", nameBn: "পেঁয়াজ", category: "fresh", unit: "kg", pricePoisha: taka(90), costPoisha: taka(70), dailyRate: true, openingStock: qty(50) });
const teaId = await mk({ nameEn: "Milk Tea", nameBn: "দুধ চা", category: "tea_coffee", pricePoisha: taka(20), costPoisha: taka(8), openingStock: qty(100), modifiers: [{ id: uuid(), name: "চিনি ছাড়া", pricePoisha: 0 }] });
await till.post("/v1/products", { ...fields, nameEn: "", nameBn: "", openingStock: 0 }, 400);
ok(true, "a product with no name is refused");
let catalog = await till.get("/v1/catalog");
const byId = (id) => catalog.products.find((p) => p.id === id);
ok(catalog.products.length === 3, "three products are on the till");
ok(byId(riceId).stock === qty(20) && byId(riceId).wholesalePricePoisha === taka(395), "opening stock and the wholesale price are saved");
ok(byId(onionId).dailyRate === true, "onion is marked as a daily-rate item");
ok(!("costPoisha" in byId(riceId)), "the cost price is not sent to tills");

step("4. Staff");
await till.post("/v1/staff", { name: "Cashier", email: null, phone: null, role: "cashier", pin: "1111" }, 400);
ok(true, "an easy PIN (1111) is refused");
await till.post("/v1/staff", { name: "Salma", email: null, phone: null, role: "cashier", pin: "3917" }, [200, 201]);
const staff = (await till.get("/v1/auth/staff")).staff;
const cashier = staff.find((s) => s.role === "cashier");
ok(cashier, "a cashier is added");
const cashierTill = client(subdomain);
cashierTill.state.device = till.state.device;
cashierTill.state.session = (await cashierTill.post("/v1/auth/pin", { userId: cashier.id, pin: "3917" })).token;
await cashierTill.post("/v1/products", { ...fields, nameEn: "Sneaky", openingStock: 0 }, 403);
await cashierTill.get("/v1/reports?from=" + today() + "&to=" + today(), 403);
ok(true, "a cashier can't add products or read reports");

step("5. Buy stock from a supplier");
const supplierId = (await till.post("/v1/suppliers", { name: "Meghna Traders", phone: "01900000011", address: null }, [200, 201])).id;
const purchaseId = uuid();
await till.post("/v1/purchases", { id: purchaseId, supplierId, invoiceNo: "INV-1", purchasedAt: new Date().toISOString(), discountPoisha: 0, lines: [{ productId: riceId, qty: qty(10), unitCostPoisha: taka(360) }], receiveNow: true, paidPoisha: taka(1000), paymentMethod: "cash", paymentRef: null }, [200, 201]);
catalog = await till.get("/v1/catalog");
ok(byId(riceId).stock === qty(30), "received goods are added to stock (20 + 10)");
const supplier = (await till.get("/v1/suppliers")).suppliers.find((s) => s.id === supplierId);
ok(supplier.duePoisha === taka(2600), "what's still owed to the supplier is tracked (3,600 − 1,000)");

step("6. Sell: cash, bKash, wholesale and baki");
const rice = byId(riceId), onion = byId(onionId), tea = byId(teaId);
const customerId = uuid();
let r = await till.post("/v1/sync/ops", { ops: [{ id: uuid(), kind: "customer_create", actorId: owner.id, payload: { id: customerId, name: "Jamal Uddin", phone: "01900000001", address: null, creditLimitPoisha: taka(5000) } }] });
ok(r.results[0].status === "accepted", "a baki customer is added from the till");
const cash = sale([line(rice, 2), line(onion, 1.5)], { cashierId: cashier.id });
const bkashNoRef = sale([line(tea, 2)], { paymentMethod: "bkash" });
const bkash = sale([line(tea, 2)], { paymentMethod: "bkash", paymentRef: "TX8K2L9" });
const wholesale = sale([line(rice, 5, rice.wholesalePricePoisha)]);
const bakiLines = [line(rice, 1)];
const baki = sale(bakiLines, { paymentMethod: "baki", customerId, tenderedPoisha: taka(110) });
const wrongTotal = { ...sale([line(tea, 1)]), totalPoisha: 1 };
r = await till.post("/v1/sync/sales", { sales: [cash, bkashNoRef, bkash, wholesale, baki, wrongTotal] });
const status = (s) => r.results.find((x) => x.id === s.id)?.status;
ok(status(cash) === "accepted" && status(bkash) === "accepted" && status(wholesale) === "accepted" && status(baki) === "accepted", "cash, bKash, wholesale and baki sales are saved");
ok(status(bkashNoRef) === "rejected", "a bKash sale without its transaction number is refused");
ok(status(wrongTotal) === "rejected", "a sale whose total doesn't add up is refused");
r = await till.post("/v1/sync/sales", { sales: [cash] });
ok(r.results[0].status === "accepted", "the same sale sent twice (bad connection) is accepted once, not doubled");
catalog = await till.get("/v1/catalog");
ok(byId(riceId).stock === qty(30 - 2 - 5 - 1), "rice stock went down by exactly what was sold");
ok(byId(onionId).stock === qty(48.5), "1.5 kg of loose onion left stock");
let customer = (await till.get("/v1/customers")).customers.find((c) => c.id === customerId);
ok(customer.duePoisha === lineTotal(bakiLines[0]) - taka(110), "the unpaid part of the baki sale is on the customer's khata");

step("7. Collect baki");
const due = customer.duePoisha;
r = await till.post("/v1/sync/ops", { ops: [{ id: uuid(), kind: "customer_payment", actorId: owner.id, payload: { id: uuid(), customerId, amountPoisha: taka(100), method: "cash", ref: null } }] });
ok(r.results[0].status === "accepted", "a baki collection is saved");
customer = (await till.get("/v1/customers")).customers.find((c) => c.id === customerId);
ok(customer.duePoisha === due - taka(100), "the khata went down by what was collected");

step("8. A table order shared between two tills");
const order = { key: `table-${tableId}`, tableName: "১", orderType: "dine_in", openedAt: new Date().toISOString(), lines: [{ key: `${teaId}|`, qty: qty(2) }], sent: {} };
await till.put(`/v1/orders/${order.key}`, order);
const secondTill = client(subdomain);
const again = await till.post("/v1/auth/request-code", { email });
if (again.devCode || process.env.E2E_CODE_CMD || process.stdin.isTTY) {
  secondTill.state.device = (await secondTill.post("/v1/auth/verify-code", { email, code: await codeFrom(again, `second till ${email}`), deviceName: "E2E counter 2" })).deviceToken;
  ok((await secondTill.get("/v1/catalog")).orders.some((o) => o.key === order.key), "the second till sees the order the first till opened");
  secondTill.state.session = (await secondTill.post("/v1/auth/pin", { userId: cashier.id, pin: "3917" })).token;
  await secondTill.del(`/v1/orders/${order.key}`);
  ok((await till.get("/v1/catalog")).orders.length === 0, "when the second till closes it, it leaves the first till too");
} else {
  ok((await till.get("/v1/catalog")).orders.length === 1, "the open order is kept on the server");
  await till.del(`/v1/orders/${order.key}`);
}

step("9. Today's rates");
await cashierTill.put("/v1/prices", { prices: [{ id: onionId, pricePoisha: taka(1) }] }, 403);
ok(true, "a cashier can't change prices");
await till.put("/v1/prices", { prices: [{ id: onionId, pricePoisha: taka(110) }, { id: riceId, pricePoisha: taka(420), wholesalePricePoisha: taka(400) }] });
catalog = await till.get("/v1/catalog");
ok(byId(onionId).pricePoisha === taka(110) && byId(riceId).pricePoisha === taka(420) && byId(riceId).wholesalePricePoisha === taka(400), "the morning's prices reach every till in one save");

step("10. A return");
const recent = (await till.get("/v1/sync/recent-sales?since=")).sales.find((s) => s.id === cash.id);
ok(recent, "the sale shows in recent sales, so it can be returned");
r = await till.post("/v1/sync/ops", { ops: [{ id: uuid(), kind: "sale_return", actorId: owner.id, payload: { id: uuid(), saleId: cash.id, creditPoisha: 0, lines: [{ lineNo: 1, qty: qty(1), restock: true }], refundMethod: "cash", refundRef: null } }] });
ok(r.results[0].status === "accepted", "one bag of rice is returned");
catalog = await till.get("/v1/catalog");
ok(byId(riceId).stock === qty(23), "the returned bag is back in stock");

step("11. Expenses, reports and the audit log");
await till.post("/v1/expenses", { id: uuid(), category: "rent", amountPoisha: taka(500), method: "cash", ref: null, note: null, spentOn: today() }, [200, 201]);
const report = await till.get(`/v1/reports?from=${today()}&to=${today()}`);
ok(JSON.stringify(report).length > 50, "today's report loads");
const pnl = await till.get(`/v1/accounts/pnl?from=${today()}&to=${today()}`);
ok(JSON.stringify(pnl).includes("50000"), "the expense shows in profit and loss");
const log = await till.get("/v1/audit");
ok(JSON.stringify(log).includes("prices_update") && JSON.stringify(log).includes("product_create"), "the audit log recorded who changed products and prices");

step("12. Privacy between stores");
const stranger = client(LIVE ? "demo" : "other");
stranger.state.device = till.state.device;
stranger.state.session = till.state.session;
await stranger.get("/v1/catalog", 401);
ok(true, "this store's till can't open another store");
await client(subdomain).get("/v1/catalog", 401);
await client(subdomain).get("/v1/customers", 401);
ok(true, "nothing is readable without a connected device");
const brand = await client(subdomain).get("/v1/brand");
ok(brand.name === "E2E Test Shop", "the store's address shows its own name");

step("13. Forgot PIN, by email");
const reset = await till.post("/v1/auth/pin-reset/request", { email });
if (reset.devCode || process.env.E2E_CODE_CMD || process.stdin.isTTY) {
  await till.post("/v1/auth/pin-reset/confirm", { email, code: await codeFrom(reset, `PIN reset ${email}`), pin: "5072" });
  await till.get("/v1/auth/me", 401);
  till.state.session = (await till.post("/v1/auth/pin", { userId: owner.id, pin: "5072" })).token;
  ok(till.state.session, "the owner set a new PIN with an emailed code; old sessions were signed out");
}

done(`Journey on ${till.base}`);
console.log(`Store: ${till.base}  ·  owner PIN is the one set last`);
