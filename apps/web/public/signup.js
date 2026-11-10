// Creates a store: send a code, then confirm with it. Text comes from the page, so English and Bangla share this file.
const form = document.getElementById("signup");
const text = form.dataset;
const $ = (name) => form.elements[name];
const error = document.getElementById("error");
const availability = document.getElementById("availability");
const codeBlock = document.getElementById("code-block");
const devCode = document.getElementById("dev-code");
const message = (code) => text[`err${code.replace(/_(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase())}`] ?? text.errSaveFailed;
let sent = false;
let timer;

const suggest = document.getElementById("suggest");
/** True once the owner types an address themselves; until then it follows the shop name. */
let addressTouched = false;

/** "Rahim's Store & Co." → "rahims-store-co". Bangla letters can't be in an address, so they're dropped. */
const slugify = (value) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 30).replace(/-+$/, "");

function showSuggestions(list) {
  suggest.replaceChildren();
  if (!list?.length) return;
  suggest.append(Object.assign(document.createElement("span"), { textContent: suggest.dataset.label }));
  for (const name of list) {
    const chip = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: `${name}.lalcha.com` });
    chip.addEventListener("click", () => {
      $("subdomain").value = name;
      addressTouched = true;
      check();
    });
    suggest.append(chip);
  }
}

async function check() {
  clearTimeout(timer);
  const name = $("subdomain").value;
  availability.textContent = "";
  availability.className = "hint";
  if (!name) return showSuggestions([]);
  timer = setTimeout(async () => {
    const query = new URLSearchParams({ name, store: $("storeName").value });
    const body = await fetch(`/v1/public/subdomain?${query}`).then((r) => r.json()).catch(() => null);
    if (!body || $("subdomain").value !== name) return; // An older answer arriving late is ignored.
    availability.textContent = body.available ? `✓ ${text.free}` : `✕ ${message(body.reason)}`;
    availability.className = body.available ? "hint ok" : "hint bad";
    showSuggestions(body.available ? [] : body.suggestions);
  }, 300);
}

$("subdomain").addEventListener("input", () => {
  $("subdomain").value = $("subdomain").value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  addressTouched = $("subdomain").value !== "";
  check();
});

// The address follows the shop name until the owner edits it.
$("storeName").addEventListener("input", () => {
  if (addressTouched) return;
  const slug = slugify($("storeName").value);
  if (slug.length >= 3 && slug !== $("subdomain").value) {
    $("subdomain").value = slug;
    check();
  }
});

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const email = $("email").value.trim().toLowerCase();
    const phone = $("phone").value.trim() || null;
    if (!sent) {
      const { ok, data } = await post("/v1/public/signup/request-code", { email });
      if (!ok) return void (error.textContent = message(data.error ?? "save_failed"));
      sent = true;
      codeBlock.hidden = false;
      $("code").required = true;
      button.textContent = text.create;
      if (data.devCode) devCode.textContent = `Development code: ${data.devCode}`;
      $("code").focus();
      return;
    }
    const { ok, data } = await post("/v1/public/signup", {
      storeName: $("storeName").value,
      subdomain: $("subdomain").value,
      ownerName: $("ownerName").value,
      email,
      phone,
      pin: $("pin").value,
      // Set by the shop-type pages ("Start free" on /for/pharmacy/), so onboarding starts on that type.
      businessType: ["grocery", "general_store", "pharmacy", "restaurant", "tea_stall", "hardware", "furniture", "electronics", "auto_parts", "fashion", "jewellery", "cosmetics", "optical", "stationery", "bakery", "agro", "wholesale", "general"].find((t) => t === new URLSearchParams(location.search).get("type")) ?? null,
      code: $("code").value,
    });
    if (!ok) {
      if (data.suggestions) {
        availability.textContent = `✕ ${message("subdomain_taken")}`;
        availability.className = "hint bad";
        showSuggestions(data.suggestions);
      }
      return void (error.textContent = message(data.error ?? "save_failed"));
    }
    // The one-time code rides after "#", which browsers never send to a server or put in its logs.
    const store = data.baseDomain === "localhost" ? `http://${data.subdomain}.localhost:4173/` : `https://${data.subdomain}.${data.baseDomain}/`;
    location.replace(data.handoff ? `${store}#connect=${data.handoff}` : store);
  } catch {
    error.textContent = text.errSaveFailed;
  } finally {
    button.disabled = false;
  }
});
