import {
  computeTotals,
  formatNumber,
  formatTaka,
  PAYMENT_METHODS,
  requiresPaymentRef,
  type CatalogProduct,
  type CustomerSummary,
  type Lang,
  type PaymentMethod,
  subscriptionState,
  type SubscriptionInfo,
  DEFAULT_SETTINGS,
  formatQty,
  isLoose,
  lineAmount,
  QTY_SCALE,
  unitLabel,
  vatInTotal,
  type StoreSettings,
  type Sale,
} from "@lalcha/domain";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { strings, type StringKey } from "./i18n";
import { ShiftDialog } from "./ShiftDialog";
import { addLocalCustomer, getStoreName, loadCustomers, loadProducts, loadSettings, loadSubscription, recordSale } from "./local";
import { SettingsScreen } from "./SettingsScreen";
import { BillingScreen } from "./BillingScreen";
import { BakiScreen } from "./BakiScreen";
import { ReportsScreen } from "./ReportsScreen";
import { ReturnsScreen } from "./ReturnsScreen";
import { v7 as uuidv7 } from "uuid";
import { name, ProductImage } from "./ProductImage";
import { remember, saved } from "./prefs";
import { ProductsScreen } from "./ProductsScreen";
import { getAuth, lock, type CurrentUser } from "./session";
import { PurchaseScreen } from "./PurchaseScreen";
import { StaffScreen } from "./StaffScreen";
import { getSyncState, refreshQueueCounts, subscribeSync, syncFresh, syncNow } from "./sync";

type CartLine = { product: CatalogProduct; qty: number };

type View = "sell" | "products" | "purchase" | "baki" | "returns" | "reports" | "staff" | "billing" | "settings";
const MANAGER_VIEWS: View[] = ["sell", "products", "purchase", "baki", "returns", "reports", "staff"];
const CASHIER_VIEWS: View[] = ["sell", "baki"];

export function App({ user }: { user: CurrentUser }) {
  const [lang, setLang] = useState<Lang>(() => saved<Lang>("lang", "bn"));
  const [theme, setTheme] = useState(() => saved<string>("theme", "light"));
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [storeName, setStoreName] = useState("");
  const [dbFailed, setDbFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountText, setDiscountText] = useState("");
  const [paying, setPaying] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [view, setView] = useState<View>("sell");
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [weighing, setWeighing] = useState<{ product: CatalogProduct; qty: number | null } | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const sync = useSyncExternalStore(subscribeSync, getSyncState);

  const t = useCallback((k: StringKey) => strings[lang][k], [lang]);
  const money = (p: number) => formatTaka(p, lang);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember("theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
    remember("lang", lang);
  }, [lang]);

  const reload = useCallback(async () => {
    try {
      const [items, store, people, sub, shop] = await Promise.all([loadProducts(), getStoreName(), loadCustomers(), loadSubscription(), loadSettings()]);
      setSettings(shop);
      setDataVersion((v) => v + 1);
      setSubscription(sub);
      setProducts(items);
      setCustomers(people);
      setStoreName(store);
      setDbFailed(false);
    } catch {
      setDbFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    void refreshQueueCounts().catch(() => setDbFailed(true));
  }, [reload]);
  useEffect(() => {
    if (sync.catalogVersion > 0) void reload();
  }, [sync.catalogVersion, reload]);

  const canManage = user.role !== "cashier";
  const plan = subscription ? subscriptionState(subscription) : null;
  useEffect(() => {
    if (!canManage) setView((v) => (CASHIER_VIEWS.includes(v) ? v : "sell"));
  }, [canManage]);

  const add = useCallback((product: CatalogProduct) => {
    if (isLoose(product.unit)) {
      setWeighing({ product, qty: null });
      return;
    }
    setCart((c) => {
      const found = c.find((l) => l.product.id === product.id);
      if (found) return c.map((l) => (l === found ? { ...l, qty: l.qty + QTY_SCALE } : l));
      return [{ product, qty: QTY_SCALE }, ...c];
    });
  }, []);

  function setLooseQty(product: CatalogProduct, qty: number) {
    setCart((c) => (c.some((l) => l.product.id === product.id) ? c.map((l) => (l.product.id === product.id ? { ...l, qty } : l)) : [{ product, qty }, ...c]));
    setWeighing(null);
  }

  const changeQty = (id: string, pieces: number) =>
    setCart((c) => c.flatMap((l) => (l.product.id !== id ? [l] : l.qty + pieces * QTY_SCALE > 0 ? [{ ...l, qty: l.qty + pieces * QTY_SCALE }] : [])));
  const removeLine = (id: string) => setCart((c) => c.filter((l) => l.product.id !== id));

  const scan = useCallback(
    (code: string) => {
      const match = products?.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
      if (match) {
        add(match);
        setNotice("");
      } else {
        setNotice(`${t("notFound")}: ${code}`);
      }
      return Boolean(match);
    },
    [products, add, t],
  );

  // Barcode scanners type quickly and press Enter, and must work even when the search box isn't selected.
  useEffect(() => {
    let buffer = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || paying || receipt || view !== "sell" || getAuth().locked) return;
      const now = performance.now();
      if (now - last > 80) buffer = "";
      last = now;
      if (e.key === "Enter" && buffer.length >= 4) {
        e.preventDefault();
        scan(buffer);
        buffer = "";
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scan, paying, receipt, view]);

  const categories = useMemo(() => ["all", ...new Set(products?.map((p) => p.category))], [products]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (products ?? []).filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (!q || [p.nameEn, p.nameBn, p.sku, p.barcode ?? ""].some((v) => v.toLowerCase().includes(q))),
    );
  }, [products, query, category]);

  const lines = cart.map((l) => ({ qty: l.qty, unitPricePoisha: l.product.pricePoisha }));
  const discountInput = Math.round(Number(discountText || 0) * 100);
  const totals = computeTotals(lines, Number.isFinite(discountInput) ? discountInput : 0);
  const count = cart.reduce((n, l) => n + (isLoose(l.product.unit) ? 1 : l.qty / QTY_SCALE), 0);

  function onSearchEnter() {
    const code = query.trim();
    if (!code) return;
    if (scan(code) || visible.length === 1) {
      if (visible.length === 1 && !products?.some((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())) {
        add(visible[0]);
        setNotice("");
      }
      setQuery("");
    }
  }

  function resetSale() {
    setCart([]);
    setDiscountText("");
    setReceipt(null);
    setPaying(false);
    setCartOpen(false);
    setQuery("");
    searchRef.current?.focus();
  }

  /** Shows queued work at once. Delivery happens in the background whenever a connection exists. */
  async function afterLocalWork() {
    await reload();
    await refreshQueueCounts();
    void syncNow();
  }

  async function addCustomer(customerName: string, phone: string | null) {
    const id = uuidv7();
    await addLocalCustomer({ id, name: customerName, phone, address: null, duePoisha: 0, creditLimitPoisha: null }, user.id);
    await reload();
    void syncNow();
    return id;
  }

  async function completeSale(method: PaymentMethod, tenderedPoisha: number, paymentRef: string | null, customerId: string | null, bakiPaidMethod: "cash" | "bkash" | "nagad") {
    const sale = await recordSale({
      cashierId: user.id,
      customerId,
      bakiPaidMethod,
      lines: cart.map((l) => ({
        productId: l.product.id,
        name: name(l.product, lang),
        qty: l.qty,
        unitPricePoisha: l.product.pricePoisha,
        unit: l.product.unit,
      })),
      vatRateBp: settings.vatEnabled ? settings.vatRateBp : 0,
      vatPoisha: settings.vatEnabled ? vatInTotal(totals.totalPoisha, settings.vatRateBp) : 0,
      discountPoisha: totals.discountPoisha,
      totalPoisha: totals.totalPoisha,
      paymentMethod: method,
      tenderedPoisha,
      paymentRef,
    });
    setPaying(false);
    setReceipt(sale);
    await reload();
    await refreshQueueCounts();
    void syncNow();
  }

  if (dbFailed) {
    return <div role="alert" className="flex h-full items-center justify-center p-8 text-center text-xl font-bold">{t("dbError")}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="no-print flex items-center gap-3 bg-[#12130f] px-4 py-2.5 text-[#f6f3e7]">
        <span className="bg-accent px-2 py-0.5 text-lg font-black text-on-accent">Lalcha</span>
        <span className="truncate font-bold">{storeName}</span>
        <div className="ml-auto flex items-center gap-2 text-sm font-bold">
          <span className="flex items-center gap-1.5" role="status" data-testid="sync-status">
            <span className={`h-2.5 w-2.5 rounded-full ${sync.online ? "bg-accent" : "bg-[#ff7a52]"}`} />
            <span className="hidden sm:inline">{sync.online ? t("online") : t("offline")}</span>
          </span>
          {sync.pending > 0 && (
            <span data-testid="pending" className="bg-[#ff7a52] px-2 py-0.5 text-[#12130f]">
              {formatNumber(sync.pending, lang)} {t("waiting")}
            </span>
          )}
          {sync.rejected > 0 && (
            <span className="bg-white px-2 py-0.5 text-[#b02a07]">
              {formatNumber(sync.rejected, lang)} {t("failed")}
            </span>
          )}
          <button data-testid="shift-button" className="min-h-9 border border-white/40 px-3" onClick={() => setShiftOpen(true)}>{t("shift")}</button>
          <button aria-label={t("lockScreen")} title={user.name} className="min-h-9 border border-white/40 px-3" onClick={lock}>
            🔒 <span className="hidden sm:inline">{user.name}</span>
          </button>
          <button className="min-h-9 border border-white/40 px-3" onClick={() => setLang(lang === "bn" ? "en" : "bn")}>
            {lang === "bn" ? "EN" : "বাং"}
          </button>
          <button
            aria-label="Toggle dark mode"
            className="min-h-9 border border-white/40 px-3"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <nav className="no-print flex shrink-0 overflow-x-auto border-b-[3px] border-line bg-panel font-black">
        {(user.role === "owner" ? [...MANAGER_VIEWS, "billing" as const, "settings" as const] : canManage ? MANAGER_VIEWS : CASHIER_VIEWS).map((v) => (
          <button key={v} aria-pressed={view === v} className={`min-h-12 flex-1 px-4 whitespace-nowrap ${view === v ? "bg-text text-bg" : ""}`} onClick={() => setView(v)}>
            {t(v)}
          </button>
        ))}
      </nav>
      {plan && (plan.status === "expired" || plan.status === "grace" || plan.daysLeft <= 7) && (
        <div role="status" data-testid="sub-banner" className="no-print flex shrink-0 items-center justify-between gap-3 bg-hot px-3 py-2 font-black text-white">
          <span>
            {plan.status === "expired"
              ? t("bannerExpired")
              : plan.status === "grace"
                ? t("bannerGrace")
                : `${t("bannerEnding")}: ${formatNumber(Math.max(plan.daysLeft, 0), lang)}`}
          </span>
          {user.role === "owner" && view !== "billing" && (
            <button className="min-h-9 shrink-0 bg-white px-3 text-[#b02a07]" onClick={() => setView("billing")}>{t("renew")}</button>
          )}
        </div>
      )}
      {view === "settings" ? (
        <SettingsScreen settings={settings} t={t} online={sync.online} onChanged={syncFresh} />
      ) : view === "billing" ? (
        <BillingScreen lang={lang} t={t} online={sync.online} onChanged={syncFresh} />
      ) : view === "sell" && plan?.status === "expired" ? (
        <main className="no-print flex flex-1 items-center justify-center p-8 text-center">
          <p data-testid="sell-blocked" className="max-w-md text-2xl font-black">{user.role === "owner" ? t("sellBlockedOwner") : t("sellBlockedStaff")}</p>
        </main>
      ) : view === "baki" ? (
        <BakiScreen customers={customers} lang={lang} t={t} online={sync.online} canManage={canManage} onChanged={afterLocalWork} />
      ) : view === "returns" ? (
        <ReturnsScreen products={products ?? []} customers={customers} storeName={storeName} lang={lang} t={t} version={dataVersion} onChanged={afterLocalWork} />
      ) : view === "reports" ? (
        <ReportsScreen lang={lang} t={t} online={sync.online} />
      ) : view === "purchase" ? (
        <PurchaseScreen products={products ?? []} lang={lang} t={t} online={sync.online} onChanged={syncFresh} />
      ) : view === "staff" ? (
        <StaffScreen user={user} lang={lang} t={t} online={sync.online} />
      ) : view === "products" ? (
        <ProductsScreen products={products ?? []} lang={lang} t={t} online={sync.online} onChanged={syncFresh} />
      ) : (
      <div className="flex min-h-0 flex-1">
        <main className="no-print flex min-w-0 flex-1 flex-col">
          <div className="space-y-2 p-3 pb-2">
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearchEnter();
              }}
              placeholder={t("search")}
              aria-label={t("search")}
              className="h-13 w-full border-[3px] border-line bg-panel px-4 text-lg font-bold placeholder:font-medium placeholder:text-muted"
            />
            {notice && <p role="alert" className="font-bold text-hot">{notice}</p>}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className={`min-h-11 shrink-0 border-2 border-line px-4 font-bold ${
                    category === c ? "bg-text text-bg" : "bg-panel"
                  }`}
                >
                  {t(c as StringKey) ?? c}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 lg:pb-3">
            {products === null || (products.length === 0 && sync.catalogVersion === 0 && sync.online) ? (
              <p className="p-10 text-center text-xl font-bold text-muted">{t("loading")}</p>
            ) : products.length === 0 ? (
              <p className="p-10 text-center text-xl font-bold text-muted">{sync.online ? t("noProductsYet") : t("firstLoad")}</p>
            ) : visible.length === 0 ? (
              <p className="p-10 text-center text-xl font-bold text-muted">{t("noResults")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {visible.map((p) => {
                  const inCart = cart.find((l) => l.product.id === p.id)?.qty ?? 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => add(p)}
                      className={`tile-press relative flex flex-col overflow-hidden border-[3px] bg-panel text-left ${
                        inCart ? "border-hot" : "border-line"
                      }`}
                    >
                      {inCart > 0 && (
                        <span className="absolute right-0 top-0 z-10 bg-hot px-2.5 py-1 text-lg font-black text-white">
                          {formatQty(inCart, p.unit, lang)}
                        </span>
                      )}
                      <div className="relative aspect-[4/3] w-full bg-tile">
                        <ProductImage product={p} lang={lang} />
                      </div>
                      <div className="flex flex-1 flex-col gap-1 border-t-[3px] border-line p-2.5">
                        <span className="line-clamp-2 min-h-11 leading-snug font-bold">{name(p, lang)}</span>
                        <span className="text-2xl leading-none font-black">{money(p.pricePoisha)}{isLoose(p.unit) ? <span className="text-base">/{unitLabel(p.unit, lang)}</span> : null}</span>
                        <span className={`text-sm font-bold ${p.stock <= 5 * QTY_SCALE ? "text-hot" : "text-muted"}`}>
                          {p.stock <= 0
                            ? t("out")
                            : p.stock <= 5 * QTY_SCALE
                              ? `${formatQty(p.stock, p.unit, lang)} ${t("low")}`
                              : `${formatQty(p.stock, p.unit, lang)} ${t("inStock")}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        <aside
          className={`no-print z-30 flex-col border-line bg-panel max-lg:fixed max-lg:inset-0 lg:flex lg:w-[390px] lg:border-l-[3px] xl:w-[430px] ${
            cartOpen ? "flex" : "hidden"
          }`}
        >
          <div className="flex items-center justify-between border-b-[3px] border-line p-3">
            <h1 className="text-xl font-black">
              {t("cart")} {count > 0 && <span className="text-muted">· {formatNumber(count, lang)} {t("items")}</span>}
            </h1>
            <div className="flex gap-2">
              {cart.length > 0 && (
                <button className="min-h-10 px-2 font-bold text-hot underline" onClick={() => setCart([])}>
                  {t("clear")}
                </button>
              )}
              <button className="min-h-10 border-2 border-line px-3 font-bold lg:hidden" onClick={() => setCartOpen(false)}>
                {t("close")}
              </button>
            </div>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 && <li className="p-10 text-center text-lg font-bold text-muted">{t("empty")}</li>}
            {cart.map((l) => (
              <li key={l.product.id} className="flex items-center gap-2.5 border-b-2 border-line/20 p-2.5">
                <div className="relative h-14 w-14 shrink-0 border-2 border-line bg-tile">
                  <ProductImage product={l.product} lang={lang} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{name(l.product, lang)}</p>
                  <p className="text-sm font-bold text-muted">{money(l.product.pricePoisha)}</p>
                </div>
                {isLoose(l.product.unit) ? (
                  <div className="flex items-center gap-1">
                    <button data-testid="edit-weight" className="h-11 min-w-20 border-2 border-line px-2 font-black" onClick={() => setWeighing({ product: l.product, qty: l.qty })}>
                      {formatQty(l.qty, l.product.unit, lang)}
                    </button>
                    <button aria-label={`${t("remove")}: ${name(l.product, lang)}`} className="h-11 w-11 border-2 border-line font-black" onClick={() => removeLine(l.product.id)}>✕</button>
                  </div>
                ) : (
                <div className="flex items-center">
                  <button
                    aria-label={`${l.qty === QTY_SCALE ? t("remove") : t("decrease")}: ${name(l.product, lang)}`}
                    className="h-11 w-11 border-2 border-line text-xl font-black"
                    onClick={() => changeQty(l.product.id, -1)}
                  >
                    −
                  </button>
                  <span className="w-9 text-center text-lg font-black">{formatQty(l.qty, l.product.unit, lang)}</span>
                  <button
                    aria-label={`${t("increase")}: ${name(l.product, lang)}`}
                    className="h-11 w-11 border-2 border-line text-xl font-black"
                    onClick={() => changeQty(l.product.id, 1)}
                  >
                    +
                  </button>
                </div>
                )}
                <span className="w-20 text-right font-black">{money(lineAmount(l.qty, l.product.pricePoisha))}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t-[3px] border-line p-3">
            <div className="flex justify-between font-bold">
              <span>{t("subtotal")}</span>
              <span>{money(totals.subtotalPoisha)}</span>
            </div>
            <label className="flex items-center justify-between gap-3 font-bold">
              <span>{t("discount")}</span>
              <input
                inputMode="decimal"
                value={discountText}
                onChange={(e) => setDiscountText(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                className="h-11 w-32 border-2 border-line bg-bg px-2 text-right text-lg font-black"
              />
            </label>
          </div>
          <div className="bg-accent p-3 text-on-accent">
            <div className="flex items-end justify-between">
              <span className="text-lg font-black">{t("total")}</span>
              <span data-testid="total" className="text-5xl leading-none font-black tracking-tight">
                {money(totals.totalPoisha)}
              </span>
            </div>
            <button
              disabled={cart.length === 0}
              onClick={() => setPaying(true)}
              className="mt-3 min-h-16 w-full bg-[#12130f] text-2xl font-black text-accent disabled:opacity-40"
            >
              {t("pay")}
            </button>
          </div>
        </aside>
      </div>
      )}

      {view === "sell" && cart.length > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="no-print fixed inset-x-3 bottom-3 z-20 flex min-h-16 items-center justify-between border-[3px] border-[#12130f] bg-accent px-4 text-on-accent lg:hidden"
        >
          <span className="text-lg font-black">{t("view")} · {formatNumber(count, lang)}</span>
          <span className="text-2xl font-black">{money(totals.totalPoisha)}</span>
        </button>
      )}

      {shiftOpen && <ShiftDialog lang={lang} t={t} onClose={() => { setShiftOpen(false); void refreshQueueCounts(); void syncNow(); }} />}
      {weighing && (
        <WeighDialog product={weighing.product} initial={weighing.qty} lang={lang} t={t} onCancel={() => setWeighing(null)} onConfirm={(qty) => setLooseQty(weighing.product, qty)} />
      )}
      {paying && <PayDialog total={totals.totalPoisha} lang={lang} t={t} canOverride={canManage} customers={customers} online={sync.online} onAddCustomer={addCustomer} onCancel={() => setPaying(false)} onConfirm={completeSale} />}
      {receipt && <Receipt sale={receipt} storeName={storeName} settings={settings} cashierName={user.name} customerName={customers.find((c) => c.id === receipt.customerId)?.name ?? null} lang={lang} t={t} onNew={resetSale} />}
    </div>
  );
}

function WeighDialog({
  product,
  initial,
  lang,
  t,
  onCancel,
  onConfirm,
}: {
  product: CatalogProduct;
  initial: number | null;
  lang: Lang;
  t: (k: StringKey) => string;
  onCancel: () => void;
  onConfirm: (qty: number) => void;
}) {
  const [text, setText] = useState(initial ? String(initial / QTY_SCALE) : "");
  const [taka, setTaka] = useState("");
  const qty = taka ? Math.round((Number(taka) * 100 * QTY_SCALE) / product.pricePoisha) : Math.round(Number(text || 0) * QTY_SCALE);
  const valid = Number.isFinite(qty) && qty > 0 && qty <= 100_000_000;
  const quick = product.unit === "kg" ? [0.25, 0.5, 1, 2, 5] : [0.5, 1, 2, 5];
  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={name(product, lang)}>
      <form
        className="w-full max-w-md space-y-3 border-[3px] border-line bg-panel p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(qty);
        }}
      >
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0 bg-tile"><ProductImage product={product} lang={lang} /></div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black">{name(product, lang)}</h2>
            <p className="font-bold text-muted">{formatTaka(product.pricePoisha, lang)} / {unitLabel(product.unit, lang)}</p>
          </div>
        </div>
        <label className="block font-bold">
          {t("quantity")} ({unitLabel(product.unit, lang)})
          <input autoFocus aria-label={t("quantity")} inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value.replace(/[^0-9.]/g, "")); setTaka(""); }} className="mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 text-right text-3xl font-black" />
        </label>
        <div className="flex gap-2">
          {quick.map((q) => (
            <button key={q} type="button" className="min-h-12 flex-1 border-2 border-line font-black" onClick={() => { setText(String(q)); setTaka(""); }}>{formatNumber(q, lang)}</button>
          ))}
        </div>
        <label className="block font-bold">
          {t("orByAmount")}
          <input aria-label={t("orByAmount")} inputMode="decimal" value={taka} onChange={(e) => setTaka(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-right text-xl font-black" />
        </label>
        <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
          <span className="font-black">{valid ? formatQty(qty, product.unit, lang) : "—"}</span>
          <span data-testid="weigh-total" className="text-4xl font-black">{formatTaka(valid ? lineAmount(qty, product.pricePoisha) : 0, lang)}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onCancel}>{t("cancel")}</button>
          <button type="submit" disabled={!valid} className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{t("addToBill")}</button>
        </div>
      </form>
    </div>
  );
}

function PayDialog({
  total,
  lang,
  t,
  customers,
  online,
  canOverride,
  onAddCustomer,
  onCancel,
  onConfirm,
}: {
  total: number;
  lang: Lang;
  t: (k: StringKey) => string;
  customers: CustomerSummary[];
  online: boolean;
  canOverride: boolean;
  onAddCustomer: (name: string, phone: string | null) => Promise<string>;
  onCancel: () => void;
  onConfirm: (m: PaymentMethod, tendered: number, ref: string | null, customerId: string | null, bakiPaidMethod: "cash" | "bkash" | "nagad") => Promise<void>;
}) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [customerError, setCustomerError] = useState("");
  const [bakiPaidMethod, setBakiPaidMethod] = useState<"cash" | "bkash" | "nagad">("cash");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashText, setCashText] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (p: number) => formatTaka(p, lang);

  const cash = cashText === "" ? total : Math.round(Number(cashText) * 100);
  const bakiPaid = cashText === "" ? 0 : Math.round(Number(cashText) * 100);
  const tendered = method === "cash" ? cash : method === "baki" ? bakiPaid : total;
  const needsRef = requiresPaymentRef(method);
  const valid =
    Number.isFinite(tendered) &&
    (method === "baki" ? Boolean(customerId) && tendered <= total : tendered >= total) &&
    (!needsRef || ref.trim().length > 0);
  const chosenCustomer = customers.find((c) => c.id === customerId);
  const overLimit =
    method === "baki" && chosenCustomer?.creditLimitPoisha != null && chosenCustomer.duePoisha + Math.max(total - tendered, 0) > chosenCustomer.creditLimitPoisha;
  const blockedByLimit = overLimit && !canOverride;
  const customerMatches = customers
    .filter((c) => {
      const q = customerQuery.trim().toLowerCase();
      return !q || c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q);
    })
    .slice(0, 4);

  async function saveNewCustomer() {
    if (!newCustomer?.name.trim()) return;
    setCustomerError("");
    try {
      setCustomerId(await onAddCustomer(newCustomer.name.trim(), newCustomer.phone || null));
      setNewCustomer(null);
    } catch {
      setCustomerError(t("saveFailed"));
    }
  }
  const quick = [...new Set([100, 500, 1000].map((n) => (Math.ceil(total / (n * 100)) || 1) * n))];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function submit() {
    if (!valid || busy || blockedByLimit) return;
    setBusy(true);
    try {
      await onConfirm(method, tendered, method === "baki" || !ref.trim() ? null : ref.trim(), method === "baki" ? customerId : null, bakiPaidMethod);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("pay")}>
      <form
        className="w-full max-w-lg space-y-3 border-[3px] border-line bg-panel p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
          <span className="text-lg font-black">{t("total")}</span>
          <span className="text-5xl leading-none font-black">{money(total)}</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {PAYMENT_METHODS.map((m) => (
            <button
              type="button"
              key={m}
              aria-pressed={method === m}
              onClick={() => {
                setMethod(m);
                setCashText("");
              }}
              className={`min-h-14 border-[3px] border-line text-sm font-black sm:text-base ${method === m ? "bg-text text-bg" : ""}`}
            >
              {t(m)}
            </button>
          ))}
        </div>

        {method === "baki" ? (
          <div className="space-y-2">
            {chosenCustomer ? (
              <div className="flex items-center justify-between gap-2 border-[3px] border-line p-2">
                <span className="min-w-0">
                  <span data-testid="chosen-customer" className="block truncate font-black">{chosenCustomer.name}</span>
                  <span className="block text-sm font-bold text-muted">{t("due")}: {money(chosenCustomer.duePoisha)}</span>
                </span>
                <button type="button" className="min-h-11 shrink-0 px-2 font-bold underline" onClick={() => setCustomerId(null)}>{t("changeUser")}</button>
              </div>
            ) : newCustomer ? (
              <div className="grid grid-cols-2 gap-2">
                <input autoFocus aria-label={t("customerName")} placeholder={t("customerName")} maxLength={120} value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} className="h-12 min-w-0 border-[3px] border-line bg-bg px-2 font-bold" />
                <input aria-label={t("phone")} placeholder="01XXXXXXXXX" inputMode="tel" maxLength={11} value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value.replace(/\D/g, "") })} className="h-12 min-w-0 border-[3px] border-line bg-bg px-2 font-bold" />
                <button type="button" className="min-h-12 border-[3px] border-line font-black" onClick={() => setNewCustomer(null)}>{t("cancel")}</button>
                <button type="button" className="min-h-12 bg-[#12130f] font-black text-accent ring-2 ring-line" onClick={() => void saveNewCustomer()}>{t("save")}</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input autoFocus aria-label={t("searchCustomer")} placeholder={t("searchCustomer")} value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} className="h-12 min-w-0 flex-1 border-[3px] border-line bg-bg px-3 font-bold" />
                  <button type="button" aria-label={t("addCustomer")} className="h-12 w-14 shrink-0 border-[3px] border-line text-xl font-black disabled:opacity-40" onClick={() => setNewCustomer({ name: customerQuery, phone: "" })}>+</button>
                </div>
                <ul>
                  {customerMatches.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="flex min-h-12 w-full items-center justify-between gap-2 border-b-2 border-line/20 px-1 text-left font-bold" onClick={() => setCustomerId(c.id)}>
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 font-black">{money(c.duePoisha)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {customers.length === 0 && <p className="font-bold text-muted">{t("noCustomers")}</p>}
              </>
            )}
            {customerError && <p role="alert" className="font-bold text-hot">{customerError}</p>}
            <label className="block font-bold">
              {t("paidNow")}
              <input inputMode="decimal" value={cashText} onChange={(e) => setCashText(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-right text-2xl font-black" />
            </label>
            {tendered > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {(["cash", "bkash", "nagad"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={bakiPaidMethod === m} onClick={() => setBakiPaidMethod(m)} className={`min-h-11 border-2 border-line font-black ${bakiPaidMethod === m ? "bg-text text-bg" : ""}`}>{t(m)}</button>
                ))}
              </div>
            )}
            {overLimit && <p role="alert" data-testid="limit-warning" className="font-bold text-hot">{canOverride ? t("overLimitWarn") : t("overLimitBlock")}</p>}
            <div className="flex items-end justify-between">
              <span className="text-lg font-black">{t("addToBaki")}</span>
              <span data-testid="baki-amount" className={`text-3xl font-black ${tendered > total ? "text-hot" : ""}`}>{money(Math.max(total - tendered, 0))}</span>
            </div>
          </div>
        ) : method === "cash" ? (
          <>
            <label className="block font-bold">
              {t("received")}
              <input
                autoFocus
                inputMode="decimal"
                value={cashText}
                onChange={(e) => setCashText(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={String(total / 100)}
                className="mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 text-right text-3xl font-black"
              />
            </label>
            <div className="flex gap-2">
              <button type="button" className="min-h-12 flex-1 border-2 border-line font-black" onClick={() => setCashText(String(total / 100))}>
                {t("exact")}
              </button>
              {quick.map((n) => (
                <button type="button" key={n} className="min-h-12 flex-1 border-2 border-line font-black" onClick={() => setCashText(String(n))}>
                  {formatNumber(n, lang)}
                </button>
              ))}
            </div>
            <div className="flex items-end justify-between">
              <span className="text-lg font-black">{t("change")}</span>
              <span className={`text-4xl font-black ${tendered < total ? "text-hot" : ""}`}>{money(Math.max(tendered - total, 0))}</span>
            </div>
          </>
        ) : (
          <label className="block font-bold">
            {t("ref")}
            <input
              autoFocus
              value={ref}
              maxLength={64}
              onChange={(e) => setRef(e.target.value)}
              className="mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 text-xl font-black"
            />
          </label>
        )}

        <div className="flex gap-2">
          <button type="button" className="min-h-16 flex-1 border-[3px] border-line text-lg font-black" onClick={onCancel}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={!valid || busy || blockedByLimit} className="min-h-16 flex-[2] bg-[#12130f] text-xl font-black text-accent disabled:opacity-40">
            {t("confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Receipt({
  sale,
  storeName,
  settings,
  cashierName,
  customerName,
  lang,
  t,
  onNew,
}: {
  sale: Sale;
  storeName: string;
  settings: StoreSettings;
  cashierName: string;
  customerName: string | null;
  lang: Lang;
  t: (k: StringKey) => string;
  onNew: () => void;
}) {
  const money = (p: number) => formatTaka(p, lang);
  const totals = computeTotals(sale.lines, sale.discountPoisha);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3" role="dialog" aria-modal="true" aria-label={t("receipt")}>
      <div className="w-full max-w-sm">
        <div id="receipt" className="border-[3px] border-line bg-panel p-4 text-sm">
          {sale.vatRateBp > 0 && <p className="text-center font-black">{t("mushakTitle")}</p>}
          <h2 className="text-center text-xl font-black">{storeName}</h2>
          {settings.address && <p className="text-center">{settings.address}</p>}
          {settings.phone && <p className="text-center">{settings.phone}</p>}
          {settings.bin && <p className="text-center font-bold">BIN: {settings.bin}</p>}
          <p className="text-center">{new Date(sale.soldAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB")}</p>
          <p className="text-center font-bold">#{sale.receiptNo}</p>
          <p className="mb-2 text-center">{t("servedBy")}: {cashierName}</p>
          {customerName && <p className="mb-2 text-center font-bold">{t("customer")}: {customerName}</p>}
          <div className="border-y-2 border-dashed border-line py-1">
            {sale.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-2 py-0.5">
                <span>{l.name} × {formatQty(l.qty, l.unit, lang)}</span>
                <span className="font-bold whitespace-nowrap">{money(lineAmount(l.qty, l.unitPricePoisha))}</span>
              </div>
            ))}
          </div>
          {sale.discountPoisha > 0 && (
            <>
              <div className="mt-1 flex justify-between"><span>{t("subtotal")}</span><span>{money(totals.subtotalPoisha)}</span></div>
              <div className="flex justify-between"><span>{t("discount")}</span><span>−{money(sale.discountPoisha)}</span></div>
            </>
          )}
          <div className="mt-1 flex justify-between text-2xl font-black"><span>{t("total")}</span><span>{money(sale.totalPoisha)}</span></div>
          {sale.vatRateBp > 0 && (
            <div className="flex justify-between font-bold"><span>{t("vatIncluded")} ({formatNumber(sale.vatRateBp / 100, lang)}%)</span><span data-testid="receipt-vat">{money(sale.vatPoisha)}</span></div>
          )}
          <div className="flex justify-between"><span>{t("paid")} ({t(sale.paymentMethod)})</span><span>{money(sale.tenderedPoisha)}</span></div>
          {sale.paymentMethod === "baki" && (
            <div className="flex justify-between text-lg font-black"><span>{t("addToBaki")}</span><span>{money(sale.totalPoisha - sale.tenderedPoisha)}</span></div>
          )}
          {sale.paymentRef && <div className="flex justify-between gap-2"><span>{t("ref")}</span><span className="break-all">{sale.paymentRef}</span></div>}
          {sale.paymentMethod === "cash" && (
            <div className="flex justify-between font-bold"><span>{t("change")}</span><span>{money(sale.tenderedPoisha - sale.totalPoisha)}</span></div>
          )}
          <p className="mt-3 text-center font-bold">{t("thanks")}</p>
        </div>
        <div className="no-print mt-2 flex gap-2">
          <button className="min-h-16 flex-1 border-[3px] border-line bg-panel text-lg font-black" onClick={() => window.print()}>
            {t("print")}
          </button>
          <button autoFocus className="min-h-16 flex-[2] bg-accent text-xl font-black text-on-accent" onClick={onNew}>
            {t("newSale")}
          </button>
        </div>
      </div>
    </div>
  );
}
