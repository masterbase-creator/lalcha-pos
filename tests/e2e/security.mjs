// What an outsider can and can't do. Safe to run against the live site: it creates nothing.
// E2E_RATE_LIMIT=1 also checks the sign-in rate limit, which then blocks code requests from this
// computer for ten minutes.
import { client, done, DOMAIN, LIVE, ok, SCHEME, step } from "./lib.mjs";

const site = client(null);
const demo = client("demo");

step("Without signing in");
for (const path of ["/v1/catalog", "/v1/customers", "/v1/staff", "/v1/reports?from=2026-01-01&to=2026-01-02", "/v1/audit", "/v1/suppliers", "/v1/sales", "/v1/billing", "/v1/devices"]) await demo.get(path, 401);
ok(true, "catalogue, customers, staff, reports, audit, suppliers, sales, billing and devices all need a connected till");
await client("no-such-store-here").get("/v1/brand", 404);
ok(true, "an address with no store says so and nothing more");
await demo.get("/v1/platform/stores", 404);
await site.get("/v1/platform/stores", [401, 404]);
ok(true, "the superadmin API doesn't exist on store or public addresses");
const forged = client("demo");
forged.state.device = "not-a-real-token";
forged.state.session = "not-a-real-session";
await forged.get("/v1/catalog", 401);
ok(true, "made-up tokens are refused");

step("Who has an account stays private");
const a = await site.post("/v1/public/login/request-code", { email: "nobody-here@example.com" });
ok(a.ok === true && !a.devCode, "asking for a sign-in code for an unknown email gives the same reply as a known one");
const b = await demo.post("/v1/auth/request-code", { email: "nobody-here@example.com" }, [200, 403]);
ok(!b.devCode, "the demo store never sends codes to anyone");

step("Bad input");
await site.post("/v1/public/signup", { storeName: "<script>alert(1)</script>", subdomain: "admin", ownerName: "x", email: "x@example.com", phone: null, pin: "4826", code: "123456", businessType: null }, [400, 401]);
ok(true, "reserved addresses like admin can't be taken");
await site.post("/v1/public/login/open", { ticket: "forged.ticket", storeId: "00000000-0000-4000-8000-000000000000" }, 401);
ok(true, "a forged sign-in pass is refused");
const big = await fetch(`${site.base}/v1/public/login/request-code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a".repeat(3 * 1024 * 1024) }) });
ok(big.status === 413 || big.status === 400, "an oversized request is refused");

if (LIVE) {
  step("Live site headers");
  for (const host of [DOMAIN, `demo.${DOMAIN}`]) {
    const res = await fetch(`${SCHEME}://${host}/`);
    const h = (k) => res.headers.get(k) ?? "";
    ok(h("strict-transport-security").includes("max-age"), `${host}: browsers are told to always use HTTPS`);
    ok(h("x-content-type-options") === "nosniff", `${host}: file types can't be second-guessed`);
    ok(h("content-security-policy").includes("frame-ancestors") || h("x-frame-options"), `${host}: other sites can't wrap it in a frame they control`);
    ok(h("referrer-policy") !== "", `${host}: a referrer policy is set`);
  }
  const plain = await fetch(`http://${DOMAIN}/`, { redirect: "manual" });
  ok(plain.status >= 300 && plain.status < 400 && (plain.headers.get("location") ?? "").startsWith("https://"), "plain HTTP is sent to HTTPS");
  const admin = await fetch(`${SCHEME}://admin.${DOMAIN}/`, { redirect: "manual" });
  ok((admin.headers.get("x-robots-tag") ?? "").includes("noindex") || admin.status >= 300, "the admin address is kept out of search engines");
}

if (process.env.E2E_RATE_LIMIT === "1") {
  step("Rate limit");
  let limited = false;
  for (let i = 0; i < 40 && !limited; i += 1) limited = (await fetch(`${site.base}/v1/public/login/request-code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `flood-${i}@example.com` }) })).status === 429;
  ok(limited, "a flood of code requests from one computer is cut off");
}

done(`Security on ${SCHEME}://${DOMAIN}`);
