// A store's data lives on its own address, so sign-in starts by going there.
const form = document.getElementById("login");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = form.elements.subdomain.value.trim().toLowerCase().replace(/^https?:\/\//, "").split(".")[0];
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name)) {
    document.getElementById("error").textContent = form.dataset.invalid;
    return;
  }
  const local = location.hostname === "localhost";
  location.href = local ? `http://${name}.localhost:4173/` : `https://${name}.${location.hostname.replace(/^www\./, "")}/`;
});
