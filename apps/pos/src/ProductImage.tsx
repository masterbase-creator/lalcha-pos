import type { CatalogProduct, Lang } from "@lalcha/domain";
import { useState } from "react";

export const name = (p: Pick<CatalogProduct, "nameEn" | "nameBn">, lang: Lang) => (lang === "bn" ? p.nameBn : p.nameEn);

type Pictured = Pick<CatalogProduct, "imageUrl" | "nameEn" | "nameBn">;

function Picture({ product, lang }: { product: Pictured; lang: Lang }) {
  const [failed, setFailed] = useState(false);
  if (!product.imageUrl || failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-4xl font-black text-[#12130f]/40">
        {name(product, lang).slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={product.imageUrl}
      alt={name(product, lang)}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-contain p-2"
    />
  );
}

/** The key resets the failed state whenever a product gets a new picture. */
export function ProductImage({ product, lang }: { product: Pictured; lang: Lang }) {
  return <Picture key={product.imageUrl ?? "none"} product={product} lang={lang} />;
}
