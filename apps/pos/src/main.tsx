import "@fontsource/archivo/700.css";
import "@fontsource/archivo/900.css";
import "@fontsource/hind-siliguri/bengali-500.css";
import "@fontsource/hind-siliguri/bengali-700.css";
import boldBangla from "@fontsource/hind-siliguri/files/hind-siliguri-bengali-700-normal.woff2?url";
import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { saved } from "./prefs";
import "./styles.css";

// Hind Siliguri below bold draws the digit ১ without its loop, so "১০" reads wrong. Digits always use the bold file.
document.fonts.add(new FontFace("Lalcha Digits", `url(${boldBangla}) format("woff2")`, { unicodeRange: "U+09E6-09EF", weight: "100 900" }));

document.documentElement.dataset.theme = saved<string>("ui-theme", "light");

/** Signup and admin load separately, so they never open the till's on-device database. */
async function page(): Promise<ReactElement> {
  // The superadmin panel exists only on its own address (admin.lalcha.com). Store addresses never show it.
  if (location.hostname.startsWith("admin.")) {
    const { Admin } = await import("./Admin");
    return <Admin />;
  }
  const { Gate } = await import("./Gate");
  return <Gate />;
}

void page().then((element) => {
  createRoot(document.getElementById("root")!).render(<StrictMode>{element}</StrictMode>);
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js");
}
