import { CATEGORIES, formatQty, formatTaka, QTY_SCALE, UNIT_NAMES, UNITS, unitLabel, type CatalogProduct, type Pack, type Unit, type Lang, type ProductDetails } from "@lalcha/domain";
import { v7 as uuidv7 } from "uuid";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StringKey } from "./i18n";
import { prepareProductImage } from "./image";
import { name, ProductImage } from "./ProductImage";
import { ImportDialog } from "./ImportDialog";
import { apiFetch } from "./session";

type T = (k: StringKey) => string;
/** "variantOf" starts a new product as a variant of an existing one, copying its details. */
type Editing = { product: CatalogProduct | null; variantOf?: CatalogProduct };

export function ProductsScreen({
  products,
  lang,
  t,
  online,
  onChanged,
}: {
  products: CatalogProduct[];
  lang: Lang;
  t: T;
  online: boolean;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => !q || [p.nameEn, p.nameBn, p.sku, p.barcode ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [products, query]);

  return (
    <main className="no-print flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-13 min-w-0 flex-1 border-[3px] border-line bg-panel px-4 text-lg font-bold placeholder:font-medium placeholder:text-muted"
        />
        <button
          disabled={!online}
          onClick={() => setEditing({ product: null })}
          className="min-h-13 shrink-0 bg-accent px-4 text-lg font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40"
        >
          + {t("addProduct")}
        </button>
        <button disabled={!online} data-testid="open-import" onClick={() => setImporting(true)} className="min-h-13 shrink-0 border-[3px] border-line bg-panel px-3 font-black disabled:opacity-40">
          {t("importProducts")}
        </button>
      </div>
      {!online && <p role="alert" className="px-3 pb-2 font-bold text-hot">{t("needOnline")}</p>}

      <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {visible.length === 0 && <li className="p-10 text-center text-xl font-bold text-muted">{t("noResults")}</li>}
        {visible.map((p) => (
          <li key={p.id} className="mb-2">
            <button
              disabled={!online}
              onClick={() => setEditing({ product: p })}
              aria-label={`${t("editProduct")}: ${name(p, lang)}`}
              className="tile-press flex w-full items-center gap-3 border-[3px] border-line bg-panel p-2 text-left disabled:cursor-default"
            >
              <div className="relative h-16 w-16 shrink-0 bg-tile">
                <ProductImage product={p} lang={lang} />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold">{name(p, lang)}</span>
                <span className={`block text-sm font-bold ${p.stock <= 5 * QTY_SCALE ? "text-hot" : "text-muted"}`}>
                  {formatQty(p.stock, p.unit, lang)} {t("inStock")}
                </span>
              </span>
              <span className="text-xl font-black">{formatTaka(p.pricePoisha, lang)}</span>
            </button>
          </li>
        ))}
      </ul>

      {importing && <ImportDialog lang={lang} t={t} onClose={() => setImporting(false)} onDone={onChanged} />}
      {editing && (
        <ProductForm
          key={editing.product?.id ?? `new-${editing.variantOf?.id ?? ""}`}
          product={editing.product}
          variantOf={editing.variantOf ?? null}
          mains={products.filter((p) => !p.variantOf)}
          onAddVariant={(main) => setEditing({ product: null, variantOf: main })}
          lang={lang}
          t={t}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      )}
    </main>
  );
}

const taka = (poisha: number) => String(poisha / 100);
const toPoisha = (text: string) => (text.trim() === "" ? NaN : Math.round(Number(text) * 100));
const fieldClass = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";

type PackRow = { id: string; name: string; qty: string; price: string; barcode: string };

function ProductForm({
  product,
  variantOf: startAsVariantOf,
  mains,
  onAddVariant,
  lang,
  t,
  onClose,
  onChanged,
}: {
  product: CatalogProduct | null;
  variantOf: CatalogProduct | null;
  /** Products that can have variants: the ones that aren't variants themselves. */
  mains: CatalogProduct[];
  onAddVariant: (main: CatalogProduct) => void;
  lang: Lang;
  t: T;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  // Set once a new product is saved, so a retry after a failed photo edits it rather than duplicating it.
  const [savedId, setSavedId] = useState(product?.id ?? null);
  const base = product ?? startAsVariantOf;
  const plain = (p: CatalogProduct | null | undefined, k: "nameEn" | "nameBn") => (p ? ((p as { plainEn?: string; plainBn?: string })[k === "nameEn" ? "plainEn" : "plainBn"] ?? p[k]) : "");
  const [nameBn, setNameBn] = useState(plain(base, "nameBn"));
  const [nameEn, setNameEn] = useState(plain(base, "nameEn"));
  const [category, setCategory] = useState<string>(base?.category ?? CATEGORIES[0]);
  // A new product must have its unit chosen on purpose: kg, feet and pieces are sold very differently.
  const [unit, setUnit] = useState<Unit | "">(base?.unit ?? "");
  const [vat, setVat] = useState(base?.vatRateBp != null ? String(base.vatRateBp / 100) : "");
  const [price, setPrice] = useState(base ? taka(base.pricePoisha) : "");
  const [variantOf, setVariantOf] = useState<string>(startAsVariantOf ? (startAsVariantOf.variantOf ?? startAsVariantOf.id) : (product?.variantOf ?? ""));
  const [variantName, setVariantName] = useState(product?.variantName ?? "");
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [cost, setCost] = useState("");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [stock, setStock] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [loaded, setLoaded] = useState(product === null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/v1/products/${product.id}`);
        if (!res.ok) throw new Error();
        const details = (await res.json()) as ProductDetails;
        if (cancelled) return;
        setCost(taka(details.costPoisha));
        setVariantOf(details.variantOf ?? "");
        setVariantName(details.variantName ?? "");
        setPacks((details.packs ?? []).map((p) => ({ id: p.id, name: p.name, qty: String(p.qty / QTY_SCALE), price: taka(p.pricePoisha), barcode: p.barcode ?? "" })));
        setLoaded(true);
      } catch {
        if (!cancelled) setError(t("saveFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product, t]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      setPhoto(await prepareProductImage(file));
    } catch {
      setError(t("badPhoto"));
    }
  }

  async function errorMessage(res: Response) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const code = body?.error as StringKey | undefined;
    return code && ["name_required", "duplicate_barcode", "duplicate_sku", "invalid_image", "image_too_large", "unit_required", "variant_name_required", "pack_name_required", "has_variants"].includes(code)
      ? t(code)
      : t("saveFailed");
  }

  async function save() {
    if (busy || !loaded) return;
    const pricePoisha = toPoisha(price);
    const costPoisha = cost.trim() === "" ? 0 : toPoisha(cost);
    const stockNumber = stock.trim() === "" ? 0 : Math.round(Number(stock) * QTY_SCALE);
    if (!Number.isFinite(pricePoisha) || !Number.isFinite(costPoisha) || pricePoisha < 0 || costPoisha < 0 || !Number.isInteger(stockNumber)) {
      setError(t("badNumber"));
      return;
    }
    if (!unit) {
      setError(t("unit_required"));
      return;
    }
    if (variantOf && !variantName.trim()) {
      setError(t("variant_name_required"));
      return;
    }
    const packList: Pack[] = packs
      .filter((p) => p.name.trim() || p.qty.trim() || p.price.trim())
      .map((p) => ({ id: p.id, name: p.name.trim(), qty: Math.round(Number(p.qty) * QTY_SCALE), pricePoisha: toPoisha(p.price), barcode: p.barcode.trim() || null }));
    if (packList.some((p) => !p.name || !(p.qty > 0) || !Number.isFinite(p.pricePoisha) || p.pricePoisha < 0)) {
      setError(t("packIncomplete"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fields = {
        nameBn, nameEn, category, pricePoisha, costPoisha, barcode: barcode.trim() || null, unit, vatRateBp: vat.trim() === "" ? null : Math.round(Number(vat) * 100),
        variantOf: variantOf || null, variantName: variantName.trim() || null, packs: packList,
      };
      let id = savedId;
      const res = id
        ? await apiFetch(`/v1/products/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...fields, stockAdjustment: stockNumber }),
          })
        : await apiFetch("/v1/products", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...fields, openingStock: stockNumber }),
          });
      if (!res.ok) {
        setError(await errorMessage(res));
        return;
      }
      if (!id) {
        id = ((await res.json()) as { id: string }).id;
        setSavedId(id);
      }
      setStock(""); // Already applied, so a retry must not add it twice.

      if (photo) {
        const upload = await apiFetch(`/v1/products/${id}/image`, { method: "PUT", headers: { "content-type": photo.type }, body: photo });
        if (!upload.ok) {
          await onChanged();
          setError(t("photoFailed"));
          return;
        }
      }
      await onChanged();
      onClose();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!savedId || busy) return;
    if (!confirmArchive) {
      setConfirmArchive(true);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/products/${savedId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await onChanged();
      onClose();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const existingImage = preview ? null : base?.imageUrl;
  const unitShort = unit ? unitLabel(unit, lang) || t("pcShort") : "";

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={product ? t("editProduct") : t("addProduct")}>
      <form
        className="max-h-full w-full max-w-xl space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="text-2xl font-black">{product ? t("editProduct") : startAsVariantOf ? t("addVariant") : t("addProduct")}</h2>

        <div className="flex items-center gap-3">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center border-[3px] border-line bg-tile">
            {preview || existingImage ? (
              <img src={preview ?? existingImage ?? undefined} alt={t("photo")} className="h-full w-full object-contain p-1" />
            ) : (
              <span className="text-4xl text-[#12130f]/40" aria-hidden>＋</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label={t("choosePhoto")}
            className="hidden"
            onChange={(e) => {
              void pickPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" className="min-h-14 flex-1 border-[3px] border-line px-3 text-lg font-black" onClick={() => fileRef.current?.click()}>
            {preview || existingImage ? t("changePhoto") : t("choosePhoto")}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-bold">
            {t("nameBn")}
            <input autoFocus maxLength={200} value={nameBn} onChange={(e) => setNameBn(e.target.value)} className={fieldClass} />
          </label>
          <label className="block font-bold">
            {t("nameEn")}
            <input maxLength={200} value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={fieldClass} />
          </label>
          <label className="block font-bold">
            {t("price")}
            <input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} className={fieldClass} />
          </label>
          <label className="block font-bold">
            {t("cost")}
            <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} className={fieldClass} />
          </label>
          <label className="block font-bold">
            {t("category")}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldClass}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(c)}</option>
              ))}
            </select>
          </label>
          <label className="block font-bold">
            {t("productVat")}
            <input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={t("useStoreRate")} className={fieldClass} />
          </label>
          <label className="block font-bold">
            {t("sellBy")} *
            <select required aria-label={t("sellBy")} value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={`${fieldClass} ${unit ? "" : "border-hot"}`}>
              <option value="" disabled>{t("chooseUnit")}</option>
              {UNITS.map((u) => (
                <option key={u} value={u}>{UNIT_NAMES[u][lang]}</option>
              ))}
            </select>
          </label>
          <label className="block font-bold">
            {t("barcode")}
            <input
              maxLength={64}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault(); // Scanners press Enter, which mustn't submit the form.
              }}
              className={fieldClass}
            />
          </label>
        </div>

        <fieldset className="space-y-2 border-[3px] border-line p-3">
          <legend className="px-1 text-lg font-black">{t("variant")}</legend>
          <p className="text-sm font-bold text-muted">{t("variantHelp")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block font-bold">
              {t("variantOf")}
              <select value={variantOf} onChange={(e) => setVariantOf(e.target.value)} className={fieldClass}>
                <option value="">{t("notAVariant")}</option>
                {mains.filter((m) => m.id !== savedId).map((m) => (
                  <option key={m.id} value={m.id}>{lang === "bn" ? m.nameBn : m.nameEn}</option>
                ))}
              </select>
            </label>
            <label className="block font-bold">
              {t("variantName")}
              <input maxLength={60} value={variantName} onChange={(e) => setVariantName(e.target.value)} placeholder={t("variantPlaceholder")} className={fieldClass} />
            </label>
          </div>
          {product && !product.variantOf && (
            <button type="button" className="min-h-11 w-full border-[3px] border-line font-black" onClick={() => onAddVariant(product)}>
              + {t("addVariant")}
            </button>
          )}
        </fieldset>

        <fieldset className="space-y-2 border-[3px] border-line p-3">
          <legend className="px-1 text-lg font-black">{t("packs")}</legend>
          <p className="text-sm font-bold text-muted">{t("packsHelp")}</p>
          {packs.map((p, i) => {
            const set = (patch: Partial<PackRow>) => setPacks((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={p.id} className="grid grid-cols-2 gap-2 border-b-2 border-line/20 pb-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
                <label className="block text-sm font-bold">{t("packName")}<input maxLength={40} value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("packPlaceholder")} className={fieldClass} /></label>
                <label className="block text-sm font-bold">{t("packContains")} ({unitShort}){<input inputMode="decimal" value={p.qty} onChange={(e) => set({ qty: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="12" className={fieldClass} />}</label>
                <label className="block text-sm font-bold">{t("price")}<input inputMode="decimal" value={p.price} onChange={(e) => set({ price: e.target.value.replace(/[^0-9.]/g, "") })} className={fieldClass} /></label>
                <button type="button" aria-label={t("remove")} className="mt-6 min-h-12 border-[3px] border-line px-3 font-black" onClick={() => setPacks((list) => list.filter((_, j) => j !== i))}>✕</button>
                <label className="col-span-2 block text-sm font-bold sm:col-span-4">{t("barcode")}<input maxLength={64} value={p.barcode} onChange={(e) => set({ barcode: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} className={fieldClass} /></label>
              </div>
            );
          })}
          {packs.length < 10 && (
            <button type="button" disabled={!unit} className="min-h-11 w-full border-[3px] border-dashed border-line font-black disabled:opacity-40" onClick={() => setPacks((list) => [...list, { id: uuidv7(), name: "", qty: "", price: "", barcode: "" }])}>
              + {t("addPack")}
            </button>
          )}
        </fieldset>

        <label className="block font-bold">
          {savedId ? `${t("adjustStock")} · ${t("currentStock")}: ${formatQty(product?.stock ?? 0, unit || "pc", lang)}` : t("openingStock")}{unitShort ? ` (${unitShort})` : ""}
          <input inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9.-]/g, ""))} placeholder="0" className={fieldClass} />
        </label>

        {error && <p role="alert" className="font-bold text-hot">{error}</p>}

        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={busy || !loaded} className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">
            {busy ? t("saving") : t("save")}
          </button>
        </div>
        {product && (
          <button type="button" disabled={busy} onClick={() => void archive()} className="min-h-11 w-full font-bold text-hot underline">
            {confirmArchive ? t("archiveConfirm") : t("archive")}
          </button>
        )}
      </form>
    </div>
  );
}
