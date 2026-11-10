CREATE TABLE "product_packs" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"price_poisha" bigint NOT NULL,
	"barcode" text,
	CONSTRAINT "product_packs_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_of" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_name" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "pack_qty" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "pack_name" text;--> statement-breakpoint
ALTER TABLE "product_packs" ADD CONSTRAINT "product_packs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_packs" ADD CONSTRAINT "product_packs_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_packs_store_barcode" ON "product_packs" USING btree ("store_id","barcode");