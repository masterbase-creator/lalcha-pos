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

$("subdomain").addEventListener("input", () => {
  $("subdomain").value = $("subdomain").value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  clearTimeout(timer);
  availability.textContent = "";
  timer = setTimeout(async () => {
    if (!$("subdomain").value) return;
    const body = await fetch(`/v1/public/subdomain?name=${encodeURIComponent($("subdomain").value)}`).then((r) => r.json()).catch(() => null);
    if (body) availability.textContent = body.available ? `✓ ${text.free}` : `✕ ${message(body.reason)}`;
  }, 300);
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
      code: $("code").value,
    });
    if (!ok) return void (error.textContent = message(data.error ?? "save_failed"));
    location.href = data.baseDomain === "localhost" ? `http://${data.subdomain}.localhost:4173/` : `https://${data.subdomain}.${data.baseDomain}/`;
  } catch {
    error.textContent = text.errSaveFailed;
  } finally {
    button.disabled = false;
  }
});
