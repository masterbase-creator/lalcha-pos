CREATE TABLE "products" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name_en" text NOT NULL,
	"name_bn" text NOT NULL,
	"category" text NOT NULL,
	"price_poisha" bigint NOT NULL,
	"cost_poisha" bigint NOT NULL,
	"image_url" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "products_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"store_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_poisha" bigint NOT NULL,
	CONSTRAINT "sale_lines_store_id_sale_id_line_no_pk" PRIMARY KEY("store_id","sale_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"receipt_no" text NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discount_poisha" bigint NOT NULL,
	"total_poisha" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"tendered_poisha" bigint NOT NULL,
	"payment_ref" text,
	CONSTRAINT "sales_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_ledger_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subdomain" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_id_sale_id_sales_store_id_id_fk" FOREIGN KEY ("store_id","sale_id") REFERENCES "public"."sales"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_sku" ON "products" USING btree ("store_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_barcode" ON "products" USING btree ("store_id","barcode");--> statement-breakpoint
CREATE INDEX "sales_store_sold_at" ON "sales" USING btree ("store_id","sold_at");--> statement-breakpoint
CREATE INDEX "stock_ledger_product" ON "stock_ledger" USING btree ("store_id","product_id");