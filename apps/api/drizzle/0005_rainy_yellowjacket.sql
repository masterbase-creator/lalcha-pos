CREATE TABLE "store_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"vat_enabled" boolean DEFAULT false NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"bin" text,
	"address" text,
	"phone" text
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text DEFAULT 'pc' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "vat_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "vat_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "sale_lines" SET "qty" = "qty" * 1000;
--> statement-breakpoint
UPDATE "purchase_lines" SET "qty" = "qty" * 1000;
--> statement-breakpoint
UPDATE "sale_return_lines" SET "qty" = "qty" * 1000;
--> statement-breakpoint
UPDATE "stock_ledger" SET "qty_delta" = "qty_delta" * 1000;
