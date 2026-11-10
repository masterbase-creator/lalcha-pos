// Sign in once on lalcha.com: email → code → your store. One store opens straight away; several show a list.
const box = document.getElementById("login");
const text = box.dataset;
const $ = (id) => document.getElementById(id);
const error = $("error");
let email = "";
let ticket = "";

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

const storeUrl = (subdomain, baseDomain) => (baseDomain === "localhost" ? `http://${subdomain}.localhost:4173/` : `https://${subdomain}.${baseDomain}/`);

async function open(storeId) {
  error.textContent = "";
  $("step-stores").setAttribute("aria-busy", "true");
  const { ok, data } = await post("/v1/public/login/open", { ticket, storeId });
  if (!ok) {
    $("step-stores").removeAttribute("aria-busy");
    error.textContent = data.error === "login_expired" ? text.expired : text.failed;
    return;
  }
  error.textContent = text.opening;
  // The one-time code rides after "#", which browsers never send to a server or put in its logs.
  location.replace(`${storeUrl(data.subdomain, data.baseDomain)}#connect=${data.handoff}`);
}

$("step-email").addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  email = e.target.elements.email.value.trim().toLowerCase();
  const button = e.target.querySelector("button");
  button.disabled = true;
  const { ok, data } = await post("/v1/public/login/request-code", { email }).catch(() => ({ ok: false, data: {} }));
  button.disabled = false;
  if (!ok) return void (error.textContent = text.failed);
  $("sent").textContent = data.devCode ? `${text.sent} (dev: ${data.devCode})` : text.sent;
  $("step-email").hidden = true;
  $("step-code").hidden = false;
  $("step-code").elements.code.focus();
});

$("step-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  const button = e.target.querySelector("button");
  button.disabled = true;
  const { ok, data } = await post("/v1/public/login/verify", { email, code: e.target.elements.code.value.trim() }).catch(() => ({ ok: false, data: {} }));
  button.disabled = false;
  if (!ok) return void (error.textContent = data.error === "invalid_code" ? text.badCode : text.failed);
  ticket = data.ticket;
  $("step-code").hidden = true;
  if (data.stores.length === 1) return void open(data.stores[0].storeId);
  const list = $("stores");
  list.replaceChildren(
    ...data.stores.map((s) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "store-pick";
      const mark = s.logoUrl ? Object.assign(document.createElement("img"), { src: storeUrl(s.subdomain, data.baseDomain) + s.logoUrl.replace(/^\//, ""), alt: "" }) : Object.assign(document.createElement("span"), { className: "letter", textContent: [...s.name.trim()][0]?.toUpperCase() ?? "" });
      const info = document.createElement("span");
      info.className = "info";
      const name = Object.assign(document.createElement("strong"), { textContent: s.name });
      const meta = Object.assign(document.createElement("small"), { textContent: `${s.subdomain}.${data.baseDomain === "localhost" ? "localhost" : data.baseDomain} · ${s.role === "owner" ? text.owner : text.manager}${s.suspended ? ` · ${text.paused}` : ""}` });
      info.append(name, meta);
      b.append(mark, info, Object.assign(document.createElement("span"), { className: "go", textContent: "→" }));
      b.addEventListener("click", () => void open(s.storeId));
      li.append(b);
      return li;
    }),
  );
  $("step-stores").hidden = false;
});

// Cashiers have no email: they go to their store's address and sign in with their PIN there.
$("by-address").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = e.target.elements.subdomain.value.trim().toLowerCase().replace(/^https?:\/\//, "").split(".")[0];
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name)) return void (error.textContent = text.invalid);
  location.href = location.hostname === "localhost" ? `http://${name}.localhost:4173/` : `https://${name}.${location.hostname.replace(/^www\./, "")}/`;
});
