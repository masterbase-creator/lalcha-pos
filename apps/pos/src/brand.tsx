import type { StoreBrand } from "@lalcha/domain";
import { useEffect, useState } from "react";

/**
 * Each shop's till carries the shop's own name and logo, not Lalcha's: in the header, the browser tab,
 * the tab icon and receipts. Kept on the device so it shows offline and before anyone signs in.
 */
const KEY = "store-brand";
let current: StoreBrand | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as StoreBrand | null;
  } catch {
    return null;
  }
})();
const listeners = new Set<(b: StoreBrand | null) => void>();

function apply(brand: StoreBrand | null) {
  if (!brand || location.hostname.startsWith("admin.")) return;
  document.title = brand.name;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon && brand.logoUrl) {
    icon.href = brand.logoUrl;
    icon.type = "";
  }
}
apply(current);

export function setBrand(brand: StoreBrand) {
  current = brand;
  try {
    localStorage.setItem(KEY, JSON.stringify(brand));
  } catch {
    // Private mode: the brand still applies for this visit.
  }
  apply(brand);
  listeners.forEach((l) => l(brand));
}

let fetched = false;
/** Fetches the brand once per page load; changes made in Settings call setBrand directly. */
export function refreshBrand() {
  if (fetched) return;
  fetched = true;
  void fetch("/v1/brand")
    .then((r) => (r.ok ? (r.json() as Promise<StoreBrand>) : null))
    .then((b) => b && setBrand(b))
    .catch(() => undefined);
}

export function useBrand() {
  const [brand, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    refreshBrand();
    return () => void listeners.delete(set);
  }, []);
  return brand;
}

/** The shop's logo, or its first letter on a dark tile when it hasn't uploaded one. */
export function BrandMark({ brand, size = 30 }: { brand: StoreBrand | null; size?: number }) {
  if (brand?.logoUrl) return <img src={brand.logoUrl} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  const letter = [...(brand?.name.trim() ?? "")][0]?.toUpperCase() ?? "";
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-md bg-text font-black text-bg" style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {letter}
    </span>
  );
}

/** Header lock-up: logo and shop name. */
export function BrandTitle({ brand, branch }: { brand: StoreBrand | null; branch?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-lg font-black">
      <BrandMark brand={brand} />
      <span className="truncate">{brand?.name ?? ""}{branch ? <span className="font-bold"> · {branch}</span> : null}</span>
    </span>
  );
}
