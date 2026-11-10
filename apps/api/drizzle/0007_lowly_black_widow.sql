CREATE TABLE "audit_log" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_id" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "branches_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "platform_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"action" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "purchase_receipts_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"store_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "stock_transfer_lines_store_id_transfer_id_line_no_pk" PRIMARY KEY("store_id","transfer_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "stock_transfers_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
DROP INDEX "stock_ledger_product";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "vat_rate_bp" integer;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "received_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "received_value_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "vat_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "vat_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "final_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "vat_inclusive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "vat_inclusive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "scale_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "scale_prefix" text DEFAULT '21' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "scale_mode" text DEFAULT 'weight' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "support_note" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_store_id_from_branch_id_branches_store_id_id_fk" FOREIGN KEY ("store_id","from_branch_id") REFERENCES "public"."branches"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_store_id_to_branch_id_branches_store_id_id_fk" FOREIGN KEY ("store_id","to_branch_id") REFERENCES "public"."branches"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_store_at" ON "audit_log" USING btree ("store_id","at");--> statement-breakpoint
CREATE INDEX "stock_transfers_store_date" ON "stock_transfers" USING btree ("store_id","created_at");--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_store_id_branch_id_branches_store_id_id_fk" FOREIGN KEY ("store_id","branch_id") REFERENCES "public"."branches"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_ledger_product" ON "stock_ledger" USING btree ("store_id","product_id","branch_id");--> statement-breakpoint
INSERT INTO "branches" ("store_id", "name") SELECT "id", 'Main' FROM "stores";
--> statement-breakpoint
UPDATE "devices" d SET "branch_id" = b."id" FROM "branches" b WHERE b."store_id" = d."store_id";
--> statement-breakpoint
UPDATE "stock_ledger" d SET "branch_id" = b."id" FROM "branches" b WHERE b."store_id" = d."store_id";
--> statement-breakpoint
UPDATE "sales" d SET "branch_id" = b."id" FROM "branches" b WHERE b."store_id" = d."store_id";
--> statement-breakpoint
UPDATE "purchases" d SET "branch_id" = b."id" FROM "branches" b WHERE b."store_id" = d."store_id";
--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "branch_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ALTER COLUMN "branch_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "branch_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "branch_id" SET NOT NULL;
--> statement-breakpoint
UPDATE "purchases" SET "received_value_poisha" = "total_poisha" WHERE "status" = 'received';
--> statement-breakpoint
UPDATE "purchase_lines" l SET "received_qty" = l."qty" FROM "purchases" p WHERE p."store_id" = l."store_id" AND p."id" = l."purchase_id" AND p."status" = 'received';
--> statement-breakpoint
UPDATE "sale_lines" l SET "final_poisha" = round(l."qty" * l."unit_price_poisha" / 1000.0 * s."total_poisha" / NULLIF(t.sub, 0)) FROM "sales" s, (SELECT "store_id", "sale_id", sum("qty" * "unit_price_poisha" / 1000.0) AS sub FROM "sale_lines" GROUP BY 1, 2) t WHERE s."store_id" = l."store_id" AND s."id" = l."sale_id" AND t."store_id" = l."store_id" AND t."sale_id" = l."sale_id";
