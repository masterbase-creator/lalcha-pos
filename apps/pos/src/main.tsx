import "@fontsource/archivo/700.css";
import "@fontsource/archivo/900.css";
import "@fontsource/hind-siliguri/bengali-500.css";
import "@fontsource/hind-siliguri/bengali-700.css";
import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { saved } from "./prefs";
import "./styles.css";

document.documentElement.dataset.theme = saved<string>("theme", "light");

/** Signup and admin load separately, so they never open the till's on-device database. */
async function page(): Promise<ReactElement> {
  if (location.pathname === "/signup") {
    const { Signup } = await import("./Signup");
    return <Signup />;
  }
  if (location.pathname === "/admin") {
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
