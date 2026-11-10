// What the till can put on a bill: each product by its own unit, plus each of its packs.
import { QTY_SCALE, type CatalogProduct } from "@lalcha/domain";

export type Sellable = CatalogProduct & {
  /** The real product, whose stock a sale takes from. */
  baseId: string;
  /** How much of the product's own unit one of these uses: 12000 for a dozen. */
  packQty: number;
  packName: string | null;
  /** Variants share their main product's key, so the till shows them as one tile. */
  groupKey: string;
  /** The product's own name without the variant, for a tile that stands for the whole group. */
  plainEn: string;
  plainBn: string;
};

const withVariant = (name: string, variant: string | null) => (variant ? `${name} · ${variant}` : name);

export function toSellables(products: CatalogProduct[]): Sellable[] {
  return products.flatMap((p) => {
    const nameEn = withVariant(p.nameEn, p.variantName);
    const nameBn = withVariant(p.nameBn, p.variantName);
    const base: Sellable = { ...p, nameEn, nameBn, plainEn: p.nameEn, plainBn: p.nameBn, baseId: p.id, packQty: QTY_SCALE, packName: null, groupKey: p.variantOf ?? p.id };
    const packs = (p.packs ?? []).map(
      (pack): Sellable => ({
        ...base,
        id: `${p.id}~${pack.id}`,
        nameEn: `${nameEn} (${pack.name})`,
        nameBn: `${nameBn} (${pack.name})`,
        pricePoisha: pack.pricePoisha,
        barcode: pack.barcode,
        // Packs are counted whole, whatever the product's own unit is.
        unit: "pc",
        stock: Math.floor(p.stock / pack.qty) * QTY_SCALE,
        packQty: pack.qty,
        packName: pack.name,
      }),
    );
    return [base, ...packs];
  });
}

export const isPack = (s: Sellable) => s.packName !== null;

/** One tile per product group, in catalogue order; the main product (not a variant) leads its group. */
export function groupTiles(list: Sellable[]) {
  const groups = new Map<string, Sellable[]>();
  for (const s of list) groups.set(s.groupKey, [...(groups.get(s.groupKey) ?? []), s]);
  return [...groups.values()].map((options) => {
    const main = options.find((o) => o.id === o.groupKey && !isPack(o)) ?? options[0];
    return { main, options: [main, ...options.filter((o) => o !== main)] };
  });
}
