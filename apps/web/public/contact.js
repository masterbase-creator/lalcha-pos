// The site has no mail server, so the form hands the message to the visitor's own email app.
const form = document.getElementById("contact");
const error = document.getElementById("error");
const topic = new URLSearchParams(location.search).get("topic");
if (topic && form.topic.querySelector(`option[value="${CSS.escape(topic)}"]`)) form.topic.value = topic;

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = form.name.value.trim();
  const message = form.message.value.trim();
  if (!name || !message) {
    error.textContent = form.dataset.required;
    return;
  }
  error.textContent = "";
  const topicLabel = form.topic.selectedOptions[0].textContent;
  const shop = form.shop.value.trim();
  const phone = form.phone.value.trim();
  const subject = `${topicLabel}: ${shop || name}`;
  const body = [message, "", `${name}`, shop, phone].filter((line, i) => i < 3 || line).join("\n");
  location.href = `mailto:${form.dataset.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
