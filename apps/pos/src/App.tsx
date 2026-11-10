// Imported, so its address carries a fingerprint and a new logo shows at once.
import logoUrl from "./logo.svg";
import {
  computeBill,
  computeTotals,
  parseScaleBarcode,
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
  type StoreSettings,
  type Sale,
  categoryLabel,
  couponDiscount,
  dueByMethod,
  hasFeature,
  pointsEarned,
  type CouponRecord,
  type Modifier,
  type TableRecord,
} from "@lalcha/domain";
import { AccountsScreen } from "./AccountsScreen";
import { ExpiryScreen } from "./ExpiryScreen";
import { LoyaltyScreen } from "./LoyaltyScreen";
import { Onboarding } from "./Onboarding";
import { AccountScreen } from "./PinReset";
import { WarrantyScreen } from "./WarrantyScreen";
import { openDrawer, printDirect, type Line as PrintLine } from "./escpos";
import { apiFetch } from "./session";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { strings, type StringKey } from "./i18n";
import { ShiftDialog } from "./ShiftDialog";
import { AuditScreen } from "./AuditScreen";
import { BranchesScreen } from "./BranchesScreen";
import { addLocalCustomer, getStoreName, loadBranchName, loadCoupons, loadCustomers, loadOpenOrders, loadProducts, loadSettings, loadSubscription, loadTables, recordSale, saveOpenOrders, type OpenOrder } from "./local";
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
import { groupTiles, isPack, toSellables, type Sellable } from "./sellables";

/**
 * One line on the bill. The same product can sit on two lines when its extras differ (a burger with
 * cheese and one without) or, for serial-tracked goods, one line per piece.
 */
type CartLine = { key: string; product: Sellable; qty: number; note: string | null; extraPoisha: number; serials: string[] };
const unitPrice = (l: CartLine) => l.product.pricePoisha + l.extraPoisha;

type View = "sell" | "products" | "purchase" | "baki" | "returns" | "reports" | "expiry" | "warranty" | "loyalty" | "accounts" | "branches" | "audit" | "staff" | "billing" | "settings" | "account";
/** The menu follows what the store switched on: a grocery never sees Warranty, a pharmacy sees Expiry. */
function viewsFor(role: string, s: StoreSettings): View[] {
  const optional: [View, boolean][] = [["expiry", hasFeature(s, "batches")], ["warranty", hasFeature(s, "serials")], ["loyalty", hasFeature(s, "loyalty")], ["accounts", hasFeature(s, "accounting")]];
  const extra = optional.filter(([, on]) => on).map(([v]) => v);
  if (role === "cashier") return ["sell", "baki", ...(hasFeature(s, "serials") ? (["warranty"] as View[]) : []), "account"];
  const manager: View[] = ["sell", "products", "purchase", "baki", "returns", "reports", ...extra, "branches", "audit", "staff"];
  return role === "owner" ? [...manager, "billing", "settings", "account"] : [...manager, "account"];
}
/** Shown inside another page, such as the demo on the website: grabbing focus there would scroll that page. */
const EMBEDDED = window.self !== window.top;

export function App({ user, demo = false }: { user: CurrentUser; demo?: boolean }) {
  const [lang, setLang] = useState<Lang>(() => saved<Lang>("lang", "bn"));
  const [theme, setTheme] = useState(() => saved<string>("ui-theme", "light"));
  const [products, setProducts] = useState<Sellable[] | null>(null);
  /** A tile with variants or packs asks which one before adding it. */
  const [choosing, setChoosing] = useState<{ title: Sellable; options: Sellable[] } | null>(null);
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
  const [branchName, setBranchName] = useState("");
  const [dataVersion, setDataVersion] = useState(0);
  const [weighing, setWeighing] = useState<{ product: Sellable; qty: number | null } | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [notice, setNotice] = useState("");
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponText, setCouponText] = useState("");
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  /** The restaurant order on screen: a table's key, "takeaway", or null for a plain counter sale. */
  const [order, setOrder] = useState<{ key: string; tableName: string | null; orderType: OpenOrder["orderType"] } | null>(null);
  const [extrasFor, setExtrasFor] = useState<Sellable | null>(null);
  const [serialFor, setSerialFor] = useState<Sellable | null>(null);
  const [kot, setKot] = useState<{ title: string; lines: CartLine[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sync = useSyncExternalStore(subscribeSync, getSyncState);

  const t = useCallback((k: StringKey) => strings[lang][k], [lang]);
  const money = (p: number) => formatTaka(p, lang);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember("ui-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
    remember("lang", lang);
  }, [lang]);

  const reload = useCallback(async () => {
    try {
      const [items, store, people, sub, shop, branch, offers, tableList, open] = await Promise.all([loadProducts(), getStoreName(), loadCustomers(), loadSubscription(), loadSettings(), loadBranchName(), loadCoupons(), loadTables(), loadOpenOrders()]);
      setCoupons(offers);
      setTables(tableList);
      setOrders(open);
      setBranchName(branch);
      setSettings(shop);
      setDataVersion((v) => v + 1);
      setSubscription(sub);
      setProducts(toSellables(items));
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
  const views = viewsFor(user.role, settings);
  useEffect(() => {
    setView((v) => (views.includes(v) ? v : "sell"));
  }, [views.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Adds one more of a plain line, or starts it. */
  const addPlain = useCallback((product: Sellable, note: string | null = null, extraPoisha = 0) => {
    const key = `${product.id}|${note ?? ""}`;
    setCart((c) => {
      const found = c.find((l) => l.key === key);
      if (found) return c.map((l) => (l === found ? { ...l, qty: l.qty + QTY_SCALE } : l));
      return [{ key, product, qty: QTY_SCALE, note, extraPoisha, serials: [] }, ...c];
    });
  }, []);

  const add = useCallback(
    (product: Sellable) => {
      if (isLoose(product.unit)) return setWeighing({ product, qty: null });
      // Phones and other serial-tracked goods: one scan per piece, so the receipt and warranty name it.
      if (product.tracking === "serial" && hasFeature(settings, "serials") && !isPack(product)) return setSerialFor(product);
      if (product.modifiers?.length && hasFeature(settings, "restaurant")) return setExtrasFor(product);
      addPlain(product);
    },
    [addPlain, settings],
  );

  function addSerial(product: Sellable, serial: string) {
    setCart((c) => {
      const found = c.find((l) => l.product.id === product.id && l.serials.length);
      if (found) return c.map((l) => (l === found ? { ...l, qty: l.qty + QTY_SCALE, serials: [...l.serials, serial] } : l));
      return [{ key: `${product.id}|serial`, product, qty: QTY_SCALE, note: null, extraPoisha: 0, serials: [serial] }, ...c];
    });
  }

  function setLooseQty(product: Sellable, qty: number) {
    const key = `${product.id}|`;
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty } : l)) : [{ key, product, qty, note: null, extraPoisha: 0, serials: [] }, ...c]));
    setWeighing(null);
  }

  // A serial line shrinks by dropping its last scanned serial; it only grows by scanning another.
  const changeQty = (key: string, pieces: number) =>
    setCart((c) =>
      c.flatMap((l) => {
        if (l.key !== key) return [l];
        if (l.serials.length && pieces > 0) {
          setSerialFor(l.product);
          return [l];
        }
        const qty = l.qty + pieces * QTY_SCALE;
        return qty > 0 ? [{ ...l, qty, serials: l.serials.length ? l.serials.slice(0, qty / QTY_SCALE) : l.serials }] : [];
      }),
    );
  const removeLine = (key: string) => setCart((c) => c.filter((l) => l.key !== key));

  const scan = useCallback(
    (code: string) => {
      const match = products?.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
      const label = !match && settings.scaleEnabled ? parseScaleBarcode(code, settings.scalePrefix) : null;
      const scaled = label && products?.find((p) => (p.barcode ?? "").replace(/^0+/, "") === label.itemCode.replace(/^0+/, ""));
      if (label && scaled) {
        const qty = settings.scaleMode === "weight" ? label.value : Math.round((label.value * QTY_SCALE) / scaled.pricePoisha);
        const key = `${scaled.id}|`;
        setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l)) : [{ key, product: scaled, qty, note: null, extraPoisha: 0, serials: [] }, ...c]));
        setNotice("");
        return true;
      }
      if (match) {
        add(match);
        setNotice("");
      } else {
        setNotice(`${t("notFound")}: ${code}`);
      }
      return Boolean(match);
    },
    [products, add, t, settings],
  );

  // Barcode scanners type quickly and press Enter, and must work even when the search box isn't selected.
  useEffect(() => {
    let buffer = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || paying || receipt || serialFor || extrasFor || view !== "sell" || getAuth().locked) return;
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
  }, [scan, paying, receipt, view, serialFor, extrasFor]);

  const categories = useMemo(() => ["all", ...new Set(products?.map((p) => p.category))], [products]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Packs aren't tiles of their own: they appear when their product's tile is tapped.
    return (products ?? []).filter(
      (p) =>
        !isPack(p) &&
        (category === "all" || p.category === category) &&
        (!q || [p.nameEn, p.nameBn, p.sku, p.barcode ?? "", p.genericName ?? ""].some((v) => v.toLowerCase().includes(q))),
    );
  }, [products, query, category]);
  const tiles = useMemo(
    () =>
      groupTiles(visible).map((g) => {
        // The main product and its packs first, then each variant with its packs.
        const options = (products ?? []).filter((p) => p.groupKey === g.main.groupKey);
        return { main: g.main, options: [...options.filter((o) => o.baseId === g.main.baseId), ...options.filter((o) => o.baseId !== g.main.baseId)] };
      }),
    [visible, products],
  );
  function tapTile(tile: { main: Sellable; options: Sellable[] }) {
    if (tile.options.length === 1) add(tile.main);
    else setChoosing({ title: tile.main, options: tile.options });
  }

  const rateOf = (p: CatalogProduct) => (settings.vatEnabled ? (p.vatRateBp ?? settings.vatRateBp) : 0);
  const lines = cart.map((l) => ({ qty: l.qty, unitPricePoisha: unitPrice(l), vatRateBp: rateOf(l.product) }));
  const discountInput = Math.round(Number(discountText || 0) * 100);
  const subtotal = lines.reduce((n, l) => n + lineAmount(l.qty, l.unitPricePoisha), 0);
  const coupon = couponCode ? coupons.find((c) => c.code === couponCode) : undefined;
  const couponOff = coupon ? (couponDiscount(coupon, subtotal) ?? 0) : 0;
  const totals = computeBill(lines, (Number.isFinite(discountInput) ? discountInput : 0) + couponOff, settings.vatInclusive);

  function applyCoupon() {
    const code = couponText.trim().toUpperCase();
    const found = coupons.find((c) => c.code === code);
    if (!found || couponDiscount(found, subtotal) === null) return setNotice(t("couponInvalid"));
    setCouponCode(code);
    setCouponText("");
    setNotice("");
  }
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
    setCouponCode(null);
    setOrder(null);
    setDiscountText("");
    setReceipt(null);
    setPaying(false);
    setCartOpen(false);
    setQuery("");
    searchRef.current?.focus({ preventScroll: true });
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

  /* ---------- Restaurant: open orders kept on this device ---------- */

  async function storeOrders(next: OpenOrder[]) {
    setOrders(next);
    await saveOpenOrders(next);
  }

  /** Saves what's on screen to its table (or takeaway ticket) and clears the screen for the next one. */
  async function keepOpen() {
    if (!order || cart.length === 0) return;
    const existing = orders.find((o) => o.key === order.key);
    const saved: OpenOrder = { key: order.key, tableName: order.tableName, orderType: order.orderType, openedAt: existing?.openedAt ?? new Date().toISOString(), lines: cart, sent: existing?.sent ?? {} };
    await storeOrders([...orders.filter((o) => o.key !== order.key), saved]);
    setCart([]);
    setOrder(null);
    setNotice(t("orderKept"));
  }

  /** Opens a table: its saved order comes back onto the screen. */
  async function openOrder(key: string, tableName: string | null, orderType: OpenOrder["orderType"]) {
    if (order && cart.length) await keepOpen();
    const saved = orders.find((o) => o.key === key);
    setCart((saved?.lines as CartLine[] | undefined) ?? []);
    setOrder({ key, tableName, orderType });
    setNotice("");
  }

  /** Prints only what the kitchen hasn't seen yet, then remembers it was sent. */
  async function sendToKitchen() {
    if (!order) return;
    const existing = orders.find((o) => o.key === order.key);
    const sent = existing?.sent ?? {};
    const fresh = cart.map((l) => ({ ...l, qty: l.qty - (sent[l.key] ?? 0) })).filter((l) => l.qty > 0);
    if (!fresh.length) return setNotice(t("nothingNew"));
    const title = order.tableName ? `${t("table")} ${order.tableName}` : t(order.orderType === "delivery" ? "delivery" : "takeaway");
    if (settings.receiptPrinter === "direct") {
      await printDirect(kitchenLines(title, fresh, lang), settings.paperWidth).catch(() => setKot({ title, lines: fresh }));
    } else setKot({ title, lines: fresh });
    const nextSent = Object.fromEntries(cart.map((l) => [l.key, l.qty]));
    await storeOrders([...orders.filter((o) => o.key !== order.key), { key: order.key, tableName: order.tableName, orderType: order.orderType, openedAt: existing?.openedAt ?? new Date().toISOString(), lines: cart, sent: nextSent }]);
    setNotice(t("sentToKitchen"));
  }

  async function completeSale(method: PaymentMethod, tenderedPoisha: number, paymentRef: string | null, customerId: string | null, bakiPaidMethod: "cash" | "bkash" | "nagad", rewards: Rewards) {
    const sale = await recordSale({
      cashierId: user.id,
      customerId,
      bakiPaidMethod,
      lines: cart.map((l) => ({
        productId: l.product.baseId,
        name: name(l.product, lang),
        qty: l.qty,
        unitPricePoisha: unitPrice(l),
        unit: l.product.unit,
        vatRateBp: rateOf(l.product),
        packQty: l.product.packQty,
        packName: l.product.packName,
        note: l.note,
        serials: l.serials,
      })),
      vatInclusive: settings.vatInclusive,
      vatPoisha: totals.vatPoisha,
      discountPoisha: totals.discountPoisha,
      totalPoisha: totals.totalPoisha,
      paymentMethod: method,
      tenderedPoisha,
      paymentRef,
      pointsRedeemed: rewards.pointsRedeemed,
      pointsPoisha: rewards.pointsPoisha,
      giftCardCode: rewards.giftCardCode,
      giftCardPoisha: rewards.giftCardPoisha,
      couponCode: couponOff > 0 ? (couponCode ?? null) : null,
      tableName: order?.tableName ?? null,
      orderType: order?.orderType ?? null,
    });
    if (order) await storeOrders(orders.filter((o) => o.key !== order.key));
    setPaying(false);
    setReceipt(sale);
    if (settings.receiptPrinter === "direct") {
      const customer = customers.find((c) => c.id === sale.customerId);
      const earned = customer && hasFeature(settings, "loyalty") ? pointsEarned(sale.paymentMethod === "baki" ? sale.tenderedPoisha : dueByMethod(sale), settings.loyaltyEarnPoisha) : 0;
      void printDirect(receiptLines(sale, { storeName, settings, cashierName: user.name, customerName: customer?.name ?? null, earned, lang, t, products: products ?? [] }), settings.paperWidth, {
        openDrawer: settings.cashDrawer && (method === "cash" || (method === "baki" && bakiPaidMethod === "cash" && tenderedPoisha > 0)),
      }).catch(() => setNotice(t("printerFailed")));
    }
    await reload();
    await refreshQueueCounts();
    void syncNow();
  }

  if (dbFailed) {
    return <div role="alert" className="flex h-full items-center justify-center p-8 text-center text-xl font-bold">{t("dbError")}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="no-print flex items-center gap-3 border-b-[3px] border-line bg-panel px-4 py-2.5 text-text">
        <span className="flex items-center gap-2 text-lg font-black"><img src={logoUrl} alt="" width={30} height={30} className="shrink-0" />Lalcha</span>
        <span className="truncate font-bold">{storeName}{branchName ? ` · ${branchName}` : ""}</span>
        <div className="ml-auto flex items-center gap-2 text-sm font-bold">
          <span className="flex items-center gap-1.5" role="status" data-testid="sync-status">
            <span className={`h-2.5 w-2.5 rounded-full ${sync.online ? "bg-[#1f7a55]" : "bg-[#d9360b]"}`} />
            <span className="hidden sm:inline">{sync.online ? t("online") : t("offline")}</span>
          </span>
          {sync.pending > 0 && (
            <span data-testid="pending" className="bg-[#ff7a52] px-2 py-0.5 text-[#12130f]">
              {formatNumber(sync.pending, lang)} {t("waiting")}
            </span>
          )}
          {sync.rejected > 0 && (
            <span className="bg-hot px-2 py-0.5 text-white">
              {formatNumber(sync.rejected, lang)} {t("failed")}
            </span>
          )}
          <button data-testid="shift-button" className="min-h-9 border-2 border-line px-3" onClick={() => setShiftOpen(true)}>{t("shift")}</button>
          {demo ? (
            <span className="hidden min-h-9 items-center px-1 sm:flex">{user.name}</span>
          ) : (
            <button aria-label={t("lockScreen")} title={user.name} className="min-h-9 border-2 border-line px-3" onClick={lock}>
              🔒 <span className="hidden sm:inline">{user.name}</span>
            </button>
          )}
          <button className="min-h-9 border-2 border-line px-3" onClick={() => setLang(lang === "bn" ? "en" : "bn")}>
            {lang === "bn" ? "EN" : "বাং"}
          </button>
          <button
            aria-label="Toggle dark mode"
            className="min-h-9 border-2 border-line px-3"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <nav className="no-print flex shrink-0 overflow-x-auto border-b-[3px] border-line bg-panel font-black">
        {views.map((v) => (
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
      {user.role === "owner" && !settings.onboarded && sync.catalogVersion > 0 ? (
        <Onboarding settings={settings} lang={lang} t={t} onDone={syncFresh} />
      ) : view === "expiry" ? (
        <ExpiryScreen lang={lang} t={t} online={sync.online} alertDays={settings.expiryAlertDays} onChanged={syncFresh} />
      ) : view === "warranty" ? (
        <WarrantyScreen lang={lang} t={t} online={sync.online} />
      ) : view === "loyalty" ? (
        <LoyaltyScreen lang={lang} t={t} online={sync.online} onChanged={syncFresh} />
      ) : view === "account" ? (
        <AccountScreen userId={user.id} role={user.role} t={t} online={sync.online} />
      ) : view === "accounts" ? (
        <AccountsScreen lang={lang} t={t} online={sync.online} />
      ) : view === "branches" ? (
        <BranchesScreen products={products ?? []} user={user} lang={lang} t={t} online={sync.online} onChanged={syncFresh} />
      ) : view === "audit" ? (
        <AuditScreen lang={lang} t={t} online={sync.online} />
      ) : view === "settings" ? (
        <SettingsScreen key={dataVersion} settings={settings} lang={lang} t={t} online={sync.online} onChanged={syncFresh} />
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
        <ProductsScreen products={(products ?? []).filter((p) => !isPack(p))} settings={settings} lang={lang} t={t} online={sync.online} onChanged={syncFresh} />
      ) : (
      <div className="flex min-h-0 flex-1">
        <main className="no-print flex min-w-0 flex-1 flex-col">
          <div className="space-y-2 p-3 pb-2">
            {hasFeature(settings, "restaurant") && (
              <div className="flex gap-2 overflow-x-auto pb-1" data-testid="tables-bar">
                <button aria-pressed={!order} onClick={() => { if (order) { void keepOpen(); setCart([]); } setOrder(null); }} className={`min-h-11 shrink-0 border-2 border-line px-3 font-black ${!order ? "bg-text text-bg" : "bg-panel"}`}>{t("counterSale")}</button>
                <button aria-pressed={order?.orderType === "takeaway"} onClick={() => void openOrder(`takeaway-${Date.now()}`, null, "takeaway")} className="min-h-11 shrink-0 border-2 border-line bg-panel px-3 font-black">+ {t("takeaway")}</button>
                {orders.filter((o) => !o.tableName).map((o) => (
                  <button key={o.key} aria-pressed={order?.key === o.key} onClick={() => void openOrder(o.key, null, o.orderType)} className={`min-h-11 shrink-0 border-2 px-3 font-black ${order?.key === o.key ? "border-line bg-text text-bg" : "border-hot bg-panel"}`}>
                    {t(o.orderType === "delivery" ? "delivery" : "takeaway")} {new Date(o.openedAt).toLocaleTimeString(lang === "bn" ? "bn-BD" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </button>
                ))}
                {tables.length === 0 && <span className="self-center text-sm font-bold text-muted">{t("noTables")}</span>}
                {tables.map((tb) => {
                  const busy = orders.some((o) => o.key === `table-${tb.id}`);
                  return (
                    <button key={tb.id} aria-pressed={order?.key === `table-${tb.id}`} onClick={() => void openOrder(`table-${tb.id}`, tb.name, "dine_in")} className={`min-h-11 shrink-0 border-2 px-3 font-black ${order?.key === `table-${tb.id}` ? "border-line bg-text text-bg" : busy ? "border-hot bg-hot/15" : "border-line bg-panel"}`}>
                      {tb.name}<span className="ml-1 text-xs">{busy ? "●" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <input
              ref={searchRef}
              autoFocus={!EMBEDDED}
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
                  {c === "all" ? t("all") : categoryLabel(c, lang)}
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
                {tiles.map((tile) => {
                  const p = tile.main;
                  const many = tile.options.length > 1;
                  const inGroup = cart.filter((l) => l.product.groupKey === p.groupKey);
                  const inCart = many ? inGroup.length * QTY_SCALE : (inGroup[0]?.qty ?? 0);
                  const lowest = Math.min(...tile.options.map((o) => o.pricePoisha));
                  const daysToExpiry = p.nextExpiry ? Math.round((Date.parse(p.nextExpiry) - Date.now()) / 86_400_000) : null;
                  return (
                    <button
                      key={p.id}
                      onClick={() => tapTile(tile)}
                      className={`tile-press relative flex flex-col overflow-hidden border-[3px] bg-panel text-left ${
                        inCart ? "border-hot" : "border-line"
                      }`}
                    >
                      {inCart > 0 && (
                        <span className="absolute right-0 top-0 z-10 bg-hot px-2.5 py-1 text-lg font-black text-white">
                          {formatQty(inCart, many ? "pc" : p.unit, lang)}
                        </span>
                      )}
                      <div className="relative aspect-[4/3] w-full bg-tile">
                        <ProductImage product={p} lang={lang} />
                        {daysToExpiry !== null && daysToExpiry <= settings.expiryAlertDays && (
                          <span className={`absolute bottom-0 left-0 z-10 px-2 py-0.5 text-sm font-black ${daysToExpiry < 0 ? "bg-hot text-white" : "bg-[#ff7a52] text-[#12130f]"}`}>
                            {daysToExpiry < 0 ? t("expired") : `${t("expiresOn")} ${new Date(p.nextExpiry!).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short" })}`}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 border-t-[3px] border-line p-2.5">
                        <span className="line-clamp-2 min-h-11 leading-snug font-bold">{many ? (lang === "bn" ? p.plainBn : p.plainEn) : name(p, lang)}</span>
                        {many ? (
                          <span className="text-2xl leading-none font-black"><span className="text-base">{t("from")} </span>{money(lowest)}<span className="block pt-1 text-sm text-muted">{formatNumber(tile.options.length, lang)} {t("options")}</span></span>
                        ) : (
                          <span className="text-2xl leading-none font-black">{money(p.pricePoisha)}{isLoose(p.unit) ? <span className="text-base">/{unitLabel(p.unit, lang)}</span> : null}</span>
                        )}
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
              <li key={l.key} className="flex items-center gap-2.5 border-b-2 border-line/20 p-2.5">
                <div className="relative h-14 w-14 shrink-0 border-2 border-line bg-tile">
                  <ProductImage product={l.product} lang={lang} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{name(l.product, lang)}</p>
                  {l.note && <p className="truncate text-sm font-bold">+ {l.note}</p>}
                  {l.serials.length > 0 && <p className="truncate font-mono text-xs font-bold text-muted">{l.serials.join(", ")}</p>}
                  <p className="text-sm font-bold text-muted">{money(unitPrice(l))}</p>
                </div>
                {isLoose(l.product.unit) ? (
                  <div className="flex items-center gap-1">
                    <button data-testid="edit-weight" className="h-11 min-w-20 border-2 border-line px-2 font-black" onClick={() => setWeighing({ product: l.product, qty: l.qty })}>
                      {formatQty(l.qty, l.product.unit, lang)}
                    </button>
                    <button aria-label={`${t("remove")}: ${name(l.product, lang)}`} className="h-11 w-11 border-2 border-line font-black" onClick={() => removeLine(l.key)}>✕</button>
                  </div>
                ) : (
                <div className="flex items-center">
                  <button
                    aria-label={`${l.qty === QTY_SCALE ? t("remove") : t("decrease")}: ${name(l.product, lang)}`}
                    className="h-11 w-11 border-2 border-line text-xl font-black"
                    onClick={() => changeQty(l.key, -1)}
                  >
                    −
                  </button>
                  <span className="w-9 text-center text-lg font-black">{formatQty(l.qty, l.product.unit, lang)}</span>
                  <button
                    aria-label={`${t("increase")}: ${name(l.product, lang)}`}
                    className="h-11 w-11 border-2 border-line text-xl font-black"
                    onClick={() => changeQty(l.key, 1)}
                  >
                    +
                  </button>
                </div>
                )}
                <span className="w-20 text-right font-black">{money(lineAmount(l.qty, unitPrice(l)))}</span>
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
            {hasFeature(settings, "loyalty") && coupons.length > 0 && (
              coupon ? (
                <div className="flex items-center justify-between gap-2 font-bold">
                  <span>{t("couponApplied")}: <span className="font-mono">{coupon.code}</span></span>
                  <span className="flex items-center gap-2">−{money(couponOff)}<button className="min-h-9 px-1 underline" onClick={() => setCouponCode(null)}>{t("removeCoupon")}</button></span>
                </div>
              ) : (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); applyCoupon(); }}>
                  <input aria-label={t("coupon")} placeholder={t("coupon")} value={couponText} onChange={(e) => setCouponText(e.target.value.toUpperCase())} className="h-11 min-w-0 flex-1 border-2 border-line bg-bg px-2 font-mono font-bold" />
                  <button disabled={!couponText.trim() || cart.length === 0} className="min-h-11 border-2 border-line px-3 font-black disabled:opacity-40">{t("applyCoupon")}</button>
                </form>
              )
            )}
          </div>
          {totals.vatPoisha > 0 && (
            <div className="flex justify-between border-t-2 border-line/20 p-3 font-bold">
              <span>{settings.vatInclusive ? t("vatIncluded") : t("vatAdded")}</span>
              <span data-testid="cart-vat">{money(totals.vatPoisha)}</span>
            </div>
          )}
          <div className="bg-accent p-3 text-on-accent">
            <div className="flex items-end justify-between">
              <span className="text-lg font-black">{t("total")}</span>
              <span data-testid="total" className="text-5xl leading-none font-black tracking-tight">
                {money(totals.totalPoisha)}
              </span>
            </div>
            {order && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button disabled={cart.length === 0} onClick={() => void keepOpen()} className="min-h-13 border-[3px] border-[#12130f] text-lg font-black disabled:opacity-40">{t("holdOrder")}</button>
                <button disabled={cart.length === 0} onClick={() => void sendToKitchen()} className="min-h-13 border-[3px] border-[#12130f] text-lg font-black disabled:opacity-40">{t("sendToKitchen")}</button>
              </div>
            )}
            <button
              disabled={cart.length === 0}
              onClick={() => setPaying(true)}
              className="mt-3 min-h-16 w-full bg-[#12130f] text-2xl font-black text-accent disabled:opacity-40"
            >
              {t("pay")}{order?.tableName ? ` · ${order.tableName}` : ""}
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
      {choosing && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={lang === "bn" ? choosing.title.plainBn : choosing.title.plainEn} onClick={() => setChoosing(null)}>
          <div className="max-h-full w-full max-w-md overflow-y-auto border-[3px] border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-2xl font-black">{lang === "bn" ? choosing.title.plainBn : choosing.title.plainEn}</h2>
            <div className="grid gap-2">
              {choosing.options.map((o) => (
                <button
                  key={o.id}
                  className="tile-press flex min-h-16 items-center justify-between gap-3 border-[3px] border-line bg-bg px-3 text-left"
                  onClick={() => {
                    setChoosing(null);
                    add(o);
                  }}
                >
                  <span>
                    <span className="block text-lg font-black">{o.packName ?? o.variantName ?? (unitLabel(o.unit, lang) || t("onePiece"))}</span>
                    <span className={`block text-sm font-bold ${o.stock <= 0 ? "text-hot" : "text-muted"}`}>{o.stock <= 0 ? t("out") : `${formatQty(o.stock, o.unit, lang)} ${t("inStock")}`}</span>
                  </span>
                  <span className="text-xl font-black whitespace-nowrap">{money(o.pricePoisha)}{isLoose(o.unit) ? <span className="text-base">/{unitLabel(o.unit, lang)}</span> : null}</span>
                </button>
              ))}
            </div>
            <button className="mt-3 min-h-12 w-full border-[3px] border-line font-black" onClick={() => setChoosing(null)}>{t("cancel")}</button>
          </div>
        </div>
      )}
      {weighing && (
        <WeighDialog product={weighing.product} initial={weighing.qty} lang={lang} t={t} onCancel={() => setWeighing(null)} onConfirm={(qty) => setLooseQty(weighing.product, qty)} />
      )}
      {extrasFor && <ExtrasDialog product={extrasFor} lang={lang} t={t} onCancel={() => setExtrasFor(null)} onConfirm={(note, extra) => { addPlain(extrasFor, note, extra); setExtrasFor(null); }} />}
      {serialFor && <SerialDialog product={serialFor} taken={cart.flatMap((l) => l.serials)} lang={lang} t={t} online={sync.online} onCancel={() => setSerialFor(null)} onConfirm={(serial) => { addSerial(serialFor, serial); setSerialFor(null); }} />}
      {kot && <KitchenTicket title={kot.title} lines={kot.lines} lang={lang} t={t} onClose={() => setKot(null)} />}
      {paying && <PayDialog total={totals.totalPoisha} lang={lang} t={t} settings={settings} canOverride={canManage} customers={customers} online={sync.online} onAddCustomer={addCustomer} onCancel={() => setPaying(false)} onConfirm={completeSale} />}
      {receipt && (
        <Receipt
          sale={receipt} storeName={storeName} settings={settings} cashierName={user.name} customerName={customers.find((c) => c.id === receipt.customerId)?.name ?? null} lang={lang} t={t} onNew={resetSale}
          products={products ?? []}
          earned={receipt.customerId && hasFeature(settings, "loyalty") ? pointsEarned(receipt.paymentMethod === "baki" ? receipt.tenderedPoisha : dueByMethod(receipt), settings.loyaltyEarnPoisha) : 0}
        />
      )}
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

type Rewards = { pointsRedeemed: number; pointsPoisha: number; giftCardCode: string | null; giftCardPoisha: number };

function PayDialog({
  total,
  lang,
  t,
  settings,
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
  settings: StoreSettings;
  customers: CustomerSummary[];
  online: boolean;
  canOverride: boolean;
  onAddCustomer: (name: string, phone: string | null) => Promise<string>;
  onCancel: () => void;
  onConfirm: (m: PaymentMethod, tendered: number, ref: string | null, customerId: string | null, bakiPaidMethod: "cash" | "bkash" | "nagad", rewards: Rewards) => Promise<void>;
}) {
  const loyalty = hasFeature(settings, "loyalty");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [customerError, setCustomerError] = useState("");
  const [bakiPaidMethod, setBakiPaidMethod] = useState<"cash" | "bkash" | "nagad">("cash");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashText, setCashText] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [cardText, setCardText] = useState("");
  const [card, setCard] = useState<{ code: string; balancePoisha: number } | null>(null);
  const [cardError, setCardError] = useState("");
  const money = (p: number) => formatTaka(p, lang);

  const chosenCustomer = customers.find((c) => c.id === customerId);
  // Points are spent in whole points, never more than the bill.
  const pointValue = settings.loyaltyPointPoisha;
  const pointsRedeemed = loyalty && usePoints && chosenCustomer ? Math.min(chosenCustomer.points ?? 0, Math.floor(total / pointValue)) : 0;
  const pointsPoisha = pointsRedeemed * pointValue;
  const giftCardPoisha = card ? Math.min(card.balancePoisha, total - pointsPoisha) : 0;
  const due = total - pointsPoisha - giftCardPoisha;

  const cash = cashText === "" ? due : Math.round(Number(cashText) * 100);
  const bakiPaid = cashText === "" ? 0 : Math.round(Number(cashText) * 100);
  const tendered = method === "cash" ? cash : method === "baki" ? bakiPaid : due;
  const needsRef = requiresPaymentRef(method) && due > 0;
  const valid =
    Number.isFinite(tendered) &&
    (method === "baki" ? Boolean(customerId) && tendered <= due : tendered >= due) &&
    (!needsRef || ref.trim().length > 0);
  const overLimit =
    method === "baki" && chosenCustomer?.creditLimitPoisha != null && chosenCustomer.duePoisha + Math.max(due - tendered, 0) > chosenCustomer.creditLimitPoisha;
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

  async function checkCard() {
    const code = cardText.trim().toUpperCase();
    if (!code) return;
    setCardError("");
    if (!online) return setCardError(t("giftCardNeedsOnline"));
    const res = await apiFetch(`/v1/gift-cards/${encodeURIComponent(code)}`).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      const known = ["unknown_gift_card", "gift_card_disabled", "gift_card_expired"];
      return setCardError(body?.error && known.includes(body.error) ? t(body.error as StringKey) : t("giftCardNeedsOnline"));
    }
    setCard((await res.json()) as { code: string; balancePoisha: number });
  }

  const quick = [...new Set([100, 500, 1000].map((n) => (Math.ceil(due / (n * 100)) || 1) * n))];

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
      await onConfirm(method, tendered, method === "baki" || !ref.trim() ? null : ref.trim(), method === "baki" || loyalty ? customerId : null, bakiPaidMethod, {
        pointsRedeemed, pointsPoisha, giftCardCode: giftCardPoisha > 0 ? card!.code : null, giftCardPoisha,
      });
    } finally {
      setBusy(false);
    }
  }

  const showCustomer = method === "baki" || loyalty;
  const picker = chosenCustomer ? (
    <div className="flex items-center justify-between gap-2 border-[3px] border-line p-2">
      <span className="min-w-0">
        <span data-testid="chosen-customer" className="block truncate font-black">{chosenCustomer.name}</span>
        <span className="block text-sm font-bold text-muted">
          {t("due")}: {money(chosenCustomer.duePoisha)}{loyalty ? ` · ${formatNumber(chosenCustomer.points ?? 0, lang)} ${t("pointsAvailable")}` : ""}
        </span>
      </span>
      <button type="button" className="min-h-11 shrink-0 px-2 font-bold underline" onClick={() => { setCustomerId(null); setUsePoints(false); }}>{t("changeUser")}</button>
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
        <input autoFocus={method === "baki"} aria-label={t("searchCustomer")} placeholder={method === "baki" ? t("searchCustomer") : `${t("customerOptional")}: ${t("searchCustomer")}`} value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} className="h-12 min-w-0 flex-1 border-[3px] border-line bg-bg px-3 font-bold" />
        <button type="button" aria-label={t("addCustomer")} className="h-12 w-14 shrink-0 border-[3px] border-line text-xl font-black disabled:opacity-40" onClick={() => setNewCustomer({ name: customerQuery, phone: "" })}>+</button>
      </div>
      {(method === "baki" || customerQuery.trim()) && (
        <ul>
          {customerMatches.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex min-h-12 w-full items-center justify-between gap-2 border-b-2 border-line/20 px-1 text-left font-bold" onClick={() => setCustomerId(c.id)}>
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 font-black">{method === "baki" ? money(c.duePoisha) : `${formatNumber(c.points ?? 0, lang)} ${t("pointsAvailable")}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {method === "baki" && customers.length === 0 && <p className="font-bold text-muted">{t("noCustomers")}</p>}
    </>
  );

  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("pay")}>
      <form
        className="max-h-full w-full max-w-lg space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
          <span className="text-lg font-black">{due !== total ? t("remainingToPay") : t("total")}</span>
          <span className="text-5xl leading-none font-black">{money(due)}</span>
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

        {showCustomer && <div className="space-y-2">{picker}{customerError && <p role="alert" className="font-bold text-hot">{customerError}</p>}</div>}

        {loyalty && (
          <div className="space-y-2 border-2 border-line/30 p-2">
            {chosenCustomer && (chosenCustomer.points ?? 0) > 0 && (
              <label className="flex min-h-11 items-center justify-between gap-3 font-bold">
                <span className="flex items-center gap-3">
                  <input type="checkbox" className="h-6 w-6" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
                  {t("usePoints")} ({formatNumber(chosenCustomer.points ?? 0, lang)})
                </span>
                {pointsPoisha > 0 && <span className="font-black">−{money(pointsPoisha)}</span>}
              </label>
            )}
            {card ? (
              <div className="flex items-center justify-between gap-2 font-bold">
                <span>{t("giftCard")} <span className="font-mono">{card.code}</span> · {t("cardBalance")} {money(card.balancePoisha)}</span>
                <span className="flex items-center gap-2 font-black">−{money(giftCardPoisha)}<button type="button" className="min-h-9 px-1 font-bold underline" onClick={() => setCard(null)}>{t("removeCoupon")}</button></span>
              </div>
            ) : (
              <div className="flex gap-2">
                <input aria-label={t("giftCardCode")} placeholder={t("giftCardCode")} value={cardText} onChange={(e) => setCardText(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void checkCard(); } }} className="h-11 min-w-0 flex-1 border-2 border-line bg-bg px-2 font-mono font-bold" />
                <button type="button" disabled={!cardText.trim()} className="min-h-11 border-2 border-line px-3 font-black disabled:opacity-40" onClick={() => void checkCard()}>{t("checkCard")}</button>
              </div>
            )}
            {cardError && <p role="alert" className="font-bold text-hot">{cardError}</p>}
          </div>
        )}

        {method === "baki" ? (
          <div className="space-y-2">
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
              <span data-testid="baki-amount" className={`text-3xl font-black ${tendered > due ? "text-hot" : ""}`}>{money(Math.max(due - tendered, 0))}</span>
            </div>
          </div>
        ) : method === "cash" ? (
          <>
            <label className="block font-bold">
              {t("received")}
              <input
                autoFocus={!loyalty}
                inputMode="decimal"
                value={cashText}
                onChange={(e) => setCashText(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={String(due / 100)}
                className="mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 text-right text-3xl font-black"
              />
            </label>
            <div className="flex gap-2">
              <button type="button" className="min-h-12 flex-1 border-2 border-line font-black" onClick={() => setCashText(String(due / 100))}>
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
              <span className={`text-4xl font-black ${tendered < due ? "text-hot" : ""}`}>{money(Math.max(tendered - due, 0))}</span>
            </div>
          </>
        ) : due > 0 && method !== "card" ? (
          <label className="block font-bold">
            {t("ref")}
            <input autoFocus={!loyalty} value={ref} maxLength={64} onChange={(e) => setRef(e.target.value)} className="mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 text-xl font-black" />
          </label>
        ) : null}

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

/** Extras for a dish: tick what the customer wants, add a note for the kitchen. */
function ExtrasDialog({ product, lang, t, onCancel, onConfirm }: { product: Sellable; lang: Lang; t: (k: StringKey) => string; onCancel: () => void; onConfirm: (note: string | null, extraPoisha: number) => void }) {
  const [chosen, setChosen] = useState<Modifier[]>([]);
  const [note, setNote] = useState("");
  const extra = chosen.reduce((n, m) => n + m.pricePoisha, 0);
  const text = [...chosen.map((m) => m.name), note.trim()].filter(Boolean).join(", ");
  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("chooseExtras")}>
      <form className="max-h-full w-full max-w-md space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4" onSubmit={(e) => { e.preventDefault(); onConfirm(text || null, extra); }}>
        <h2 className="text-2xl font-black">{name(product, lang)}</h2>
        <p className="font-bold text-muted">{t("chooseExtras")}</p>
        <div className="grid gap-2">
          {(product.modifiers ?? []).map((m) => {
            const on = chosen.some((c) => c.id === m.id);
            return (
              <button type="button" key={m.id} aria-pressed={on} onClick={() => setChosen((list) => (on ? list.filter((c) => c.id !== m.id) : [...list, m]))} className={`flex min-h-14 items-center justify-between border-[3px] px-3 text-lg font-black ${on ? "border-hot bg-hot/10" : "border-line bg-bg"}`}>
                <span>{on ? "✓ " : ""}{m.name}</span>
                <span>{m.pricePoisha ? `+${formatTaka(m.pricePoisha, lang)}` : ""}</span>
              </button>
            );
          })}
        </div>
        <label className="block font-bold">{t("kitchenNote")}<input maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 font-bold" /></label>
        <div className="flex items-end justify-between bg-accent p-3 text-on-accent">
          <span className="font-black">{t("total")}</span>
          <span className="text-3xl font-black">{formatTaka(product.pricePoisha + extra, lang)}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onCancel}>{t("cancel")}</button>
          <button className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line">{t("addToBill")}</button>
        </div>
      </form>
    </div>
  );
}

/** One scan per phone or appliance. Serials in stock are suggested; an unknown one is still allowed. */
function SerialDialog({ product, taken, lang, t, online, onCancel, onConfirm }: { product: Sellable; taken: string[]; lang: Lang; t: (k: StringKey) => string; online: boolean; onCancel: () => void; onConfirm: (serial: string) => void }) {
  const [serial, setSerial] = useState("");
  const [inStock, setInStock] = useState<string[] | null>(null);
  useEffect(() => {
    if (!online) return;
    void apiFetch(`/v1/products/${product.baseId}/serials`).then(async (r) => (r.ok ? setInStock(((await r.json()) as { serials: string[] }).serials) : undefined)).catch(() => undefined);
  }, [product.baseId, online]);
  const value = serial.trim();
  const duplicate = taken.includes(value);
  const suggestions = (inStock ?? []).filter((x) => !taken.includes(x) && (!value || x.toLowerCase().includes(value.toLowerCase()))).slice(0, 6);
  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t("enterSerial")}>
      <form className="w-full max-w-md space-y-3 border-[3px] border-line bg-panel p-4" onSubmit={(e) => { e.preventDefault(); if (value && !duplicate) onConfirm(value); }}>
        <h2 className="text-2xl font-black">{name(product, lang)}</h2>
        <label className="block font-bold">{t("enterSerial")}<input autoFocus maxLength={64} value={serial} onChange={(e) => setSerial(e.target.value)} className="mt-1 h-14 w-full border-[3px] border-line bg-bg px-3 font-mono text-xl font-black" /></label>
        {duplicate && <p role="alert" className="font-bold text-hot">{t("serialAlready")}</p>}
        {value && inStock && !inStock.includes(value) && !duplicate && <p className="font-bold text-muted">{t("serialUnknown")}</p>}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((x) => <button type="button" key={x} className="min-h-11 border-2 border-line px-3 font-mono font-bold" onClick={() => onConfirm(x)}>{x}</button>)}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onCancel}>{t("cancel")}</button>
          <button disabled={!value || duplicate} className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">{t("addToBill")}</button>
        </div>
      </form>
    </div>
  );
}

/** A kitchen ticket for the browser print window: big type, items and notes only, no prices. */
function KitchenTicket({ title, lines, lang, t, onClose }: { title: string; lines: CartLine[]; lang: Lang; t: (k: StringKey) => string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label={t("kitchenTicket")}>
      <div className="w-full max-w-sm">
        <div id="receipt" className="border-[3px] border-line bg-panel p-4">
          <p className="text-center font-black">{t("kitchenTicket")}</p>
          <h2 className="text-center text-3xl font-black">{title}</h2>
          <p className="mb-2 text-center">{new Date().toLocaleTimeString(lang === "bn" ? "bn-BD" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
          {lines.map((l) => (
            <div key={l.key} className="border-t-2 border-dashed border-line py-1.5">
              <p className="text-xl font-black">{formatQty(l.qty, l.product.unit, lang)} × {name(l.product, lang)}</p>
              {l.note && <p className="text-lg font-bold">→ {l.note}</p>}
            </div>
          ))}
        </div>
        <button autoFocus className="no-print mt-2 min-h-14 w-full bg-accent text-xl font-black text-on-accent" onClick={onClose}>{t("close")}</button>
      </div>
    </div>
  );
}

type ReceiptContext = { storeName: string; settings: StoreSettings; cashierName: string; customerName: string | null; earned: number; lang: Lang; t: (k: StringKey) => string; products: Sellable[] };

const warrantyMonthsOf = (products: Sellable[], productId: string) => products.find((p) => p.baseId === productId)?.warrantyMonths ?? null;
function warrantyDate(soldAt: string, months: number, lang: Lang) {
  const d = new Date(soldAt);
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB");
}

/** The same receipt as the screen, as lines for a thermal printer. */
function receiptLines(sale: Sale, c: ReceiptContext): PrintLine[] {
  const { t, lang, settings } = c;
  const money = (p: number) => formatTaka(p, lang);
  const subtotal = computeTotals(sale.lines, sale.discountPoisha).subtotalPoisha;
  const out: PrintLine[] = [];
  if (sale.vatPoisha > 0) out.push({ kind: "text", text: t("mushakTitle"), align: "center", bold: true, size: "small" });
  out.push({ kind: "text", text: c.storeName, align: "center", bold: true, size: "large" });
  for (const x of [settings.address, settings.phone, settings.bin ? `BIN: ${settings.bin}` : null]) if (x) out.push({ kind: "text", text: x, align: "center", size: "small" });
  out.push({ kind: "text", text: `${new Date(sale.soldAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB")} · #${sale.receiptNo}`, align: "center", size: "small" });
  out.push({ kind: "text", text: `${t("servedBy")}: ${c.cashierName}${sale.tableName ? ` · ${t("table")} ${sale.tableName}` : ""}`, align: "center", size: "small" });
  if (c.customerName) out.push({ kind: "text", text: `${t("customer")}: ${c.customerName}`, align: "center", bold: true });
  out.push({ kind: "rule" });
  for (const l of sale.lines) {
    out.push({ kind: "pair", left: `${l.name} × ${formatQty(l.qty, l.unit, lang)}`, right: money(lineAmount(l.qty, l.unitPricePoisha)) });
    if (l.note) out.push({ kind: "text", text: `  + ${l.note}`, size: "small" });
    if (l.serials.length) {
      const months = warrantyMonthsOf(c.products, l.productId);
      out.push({ kind: "text", text: `  ${t("serialShort")}: ${l.serials.join(", ")}${months ? ` · ${t("warrantyUntil")} ${warrantyDate(sale.soldAt, months, lang)}` : ""}`, size: "small" });
    }
  }
  out.push({ kind: "rule" });
  if (sale.discountPoisha > 0) {
    out.push({ kind: "pair", left: t("subtotal"), right: money(subtotal) });
    out.push({ kind: "pair", left: `${t("discount")}${sale.couponCode ? ` (${sale.couponCode})` : ""}`, right: `−${money(sale.discountPoisha)}` });
  }
  out.push({ kind: "pair", left: t("total"), right: money(sale.totalPoisha), bold: true, size: "large" });
  if (sale.vatPoisha > 0) out.push({ kind: "pair", left: sale.vatInclusive ? t("vatIncluded") : t("vatAdded"), right: money(sale.vatPoisha) });
  if (sale.pointsPoisha > 0) out.push({ kind: "pair", left: t("paidByPoints"), right: money(sale.pointsPoisha) });
  if (sale.giftCardPoisha > 0) out.push({ kind: "pair", left: t("paidByGiftCard"), right: money(sale.giftCardPoisha) });
  out.push({ kind: "pair", left: `${t("paid")} (${t(sale.paymentMethod)})`, right: money(sale.tenderedPoisha) });
  if (sale.paymentMethod === "baki") out.push({ kind: "pair", left: t("addToBaki"), right: money(dueByMethod(sale) - sale.tenderedPoisha), bold: true });
  if (sale.paymentMethod === "cash") out.push({ kind: "pair", left: t("change"), right: money(sale.tenderedPoisha - dueByMethod(sale)) });
  if (c.earned > 0) out.push({ kind: "text", text: `+${formatNumber(c.earned, lang)} ${t("pointsEarnedNote")}`, align: "center" });
  out.push({ kind: "gap" }, { kind: "text", text: t("thanks"), align: "center", bold: true });
  return out;
}

function kitchenLines(title: string, lines: CartLine[], lang: Lang): PrintLine[] {
  return [
    { kind: "text", text: title, align: "center", bold: true, size: "large" },
    { kind: "text", text: new Date().toLocaleTimeString(lang === "bn" ? "bn-BD" : "en-GB", { hour: "2-digit", minute: "2-digit" }), align: "center" },
    { kind: "rule" },
    ...lines.flatMap((l): PrintLine[] => [
      { kind: "text", text: `${formatQty(l.qty, l.product.unit, lang)} × ${name(l.product, lang)}`, bold: true, size: "large" },
      ...(l.note ? [{ kind: "text" as const, text: `→ ${l.note}`, bold: true }] : []),
    ]),
  ];
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
  products,
  earned,
}: {
  sale: Sale;
  storeName: string;
  settings: StoreSettings;
  cashierName: string;
  customerName: string | null;
  lang: Lang;
  t: (k: StringKey) => string;
  onNew: () => void;
  products: Sellable[];
  earned: number;
}) {
  const money = (p: number) => formatTaka(p, lang);
  const totals = computeTotals(sale.lines, sale.discountPoisha);
  const [printError, setPrintError] = useState("");
  async function print() {
    if (settings.receiptPrinter !== "direct") return window.print();
    setPrintError("");
    await printDirect(receiptLines(sale, { storeName, settings, cashierName, customerName, earned, lang, t, products }), settings.paperWidth).catch(() => setPrintError(t("printerFailed")));
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3" role="dialog" aria-modal="true" aria-label={t("receipt")}>
      <div className="w-full max-w-sm">
        <div id="receipt" className={`border-[3px] border-line bg-panel p-4 text-sm ${settings.paperWidth === 58 ? "receipt-58" : ""}`}>
          {sale.vatPoisha > 0 && <p className="text-center font-black">{t("mushakTitle")}</p>}
          <h2 className="text-center text-xl font-black">{storeName}</h2>
          {settings.address && <p className="text-center">{settings.address}</p>}
          {settings.phone && <p className="text-center">{settings.phone}</p>}
          {settings.bin && <p className="text-center font-bold">BIN: {settings.bin}</p>}
          <p className="text-center">{new Date(sale.soldAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB")}</p>
          <p className="text-center font-bold">#{sale.receiptNo}</p>
          <p className="mb-2 text-center">{t("servedBy")}: {cashierName}{sale.tableName ? ` · ${t("table")} ${sale.tableName}` : ""}</p>
          {customerName && <p className="mb-2 text-center font-bold">{t("customer")}: {customerName}</p>}
          <div className="border-y-2 border-dashed border-line py-1">
            {sale.lines.map((l, i) => {
              const months = l.serials.length ? warrantyMonthsOf(products, l.productId) : null;
              return (
                <div key={i} className="py-0.5">
                  <div className="flex justify-between gap-2">
                    <span>{l.name} × {formatQty(l.qty, l.unit, lang)}</span>
                    <span className="font-bold whitespace-nowrap">{money(lineAmount(l.qty, l.unitPricePoisha))}</span>
                  </div>
                  {l.note && <p className="pl-2 text-xs">+ {l.note}</p>}
                  {l.serials.length > 0 && <p className="pl-2 font-mono text-xs">{t("serialShort")}: {l.serials.join(", ")}{months ? ` · ${t("warrantyUntil")} ${warrantyDate(sale.soldAt, months, lang)}` : ""}</p>}
                </div>
              );
            })}
          </div>
          {sale.discountPoisha > 0 && (
            <>
              <div className="mt-1 flex justify-between"><span>{t("subtotal")}</span><span>{money(totals.subtotalPoisha)}</span></div>
              <div className="flex justify-between"><span>{t("discount")}{sale.couponCode ? ` (${sale.couponCode})` : ""}</span><span>−{money(sale.discountPoisha)}</span></div>
            </>
          )}
          <div className="mt-1 flex justify-between text-2xl font-black"><span>{t("total")}</span><span>{money(sale.totalPoisha)}</span></div>
          {sale.vatPoisha > 0 && (
            <div className="flex justify-between font-bold"><span>{sale.vatInclusive ? t("vatIncluded") : t("vatAdded")} ({[...new Set(sale.lines.map((l) => l.vatRateBp).filter(Boolean))].map((r) => `${formatNumber(r / 100, lang)}%`).join(", ")})</span><span data-testid="receipt-vat">{money(sale.vatPoisha)}</span></div>
          )}
          {sale.pointsPoisha > 0 && <div className="flex justify-between"><span>{t("paidByPoints")} ({formatNumber(sale.pointsRedeemed, lang)})</span><span>{money(sale.pointsPoisha)}</span></div>}
          {sale.giftCardPoisha > 0 && <div className="flex justify-between"><span>{t("paidByGiftCard")}</span><span>{money(sale.giftCardPoisha)}</span></div>}
          <div className="flex justify-between"><span>{t("paid")} ({t(sale.paymentMethod)})</span><span>{money(sale.tenderedPoisha)}</span></div>
          {sale.paymentMethod === "baki" && (
            <div className="flex justify-between text-lg font-black"><span>{t("addToBaki")}</span><span>{money(dueByMethod(sale) - sale.tenderedPoisha)}</span></div>
          )}
          {sale.paymentRef && <div className="flex justify-between gap-2"><span>{t("ref")}</span><span className="break-all">{sale.paymentRef}</span></div>}
          {sale.paymentMethod === "cash" && (
            <div className="flex justify-between font-bold"><span>{t("change")}</span><span>{money(sale.tenderedPoisha - dueByMethod(sale))}</span></div>
          )}
          {earned > 0 && <p className="mt-2 text-center font-bold">+{formatNumber(earned, lang)} {t("pointsEarnedNote")}</p>}
          <p className="mt-3 text-center font-bold">{t("thanks")}</p>
        </div>
        {printError && <p role="alert" className="no-print mt-2 bg-panel p-2 font-bold text-hot">{printError}</p>}
        <div className="no-print mt-2 flex gap-2">
          <button className="min-h-16 flex-1 border-[3px] border-line bg-panel text-lg font-black" onClick={() => void print()}>
            {t("print")}
          </button>
          {settings.receiptPrinter === "direct" && settings.cashDrawer && (
            <button className="min-h-16 border-[3px] border-line bg-panel px-3 font-black" onClick={() => void openDrawer().catch(() => setPrintError(t("printerFailed")))}>{t("openDrawer")}</button>
          )}
          <button autoFocus className="min-h-16 flex-[2] bg-accent text-xl font-black text-on-accent" onClick={onNew}>
            {t("newSale")}
          </button>
        </div>
      </div>
    </div>
  );
}
