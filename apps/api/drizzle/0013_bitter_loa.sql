CREATE TABLE "coupons" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"min_spend_poisha" bigint DEFAULT 0 NOT NULL,
	"max_discount_poisha" bigint,
	"valid_until" date,
	"max_uses" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"method" text NOT NULL,
	"ref" text,
	"note" text,
	"spent_on" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "expenses_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "gift_card_ledger" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_card_ledger_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"initial_poisha" bigint NOT NULL,
	"customer_id" uuid,
	"expires_on" date,
	"sold_method" text NOT NULL,
	"sold_ref" text,
	"disabled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_id" uuid,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "product_serials" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text NOT NULL,
	"purchase_id" uuid,
	"sale_id" uuid,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_serials_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "restaurant_tables" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"area" text,
	"seats" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_tables_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batches_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracking" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "warranty_months" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "generic_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "points_redeemed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "points_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "gift_card_code" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "gift_card_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "table_name" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "order_type" text;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "loyalty_earn_poisha" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "loyalty_point_poisha" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "receipt_printer" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "paper_width" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "cash_drawer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "kitchen_tickets" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "expiry_alert_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_ledger" ADD CONSTRAINT "gift_card_ledger_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_store_code" ON "coupons" USING btree ("store_id","code");--> statement-breakpoint
CREATE INDEX "expenses_store_date" ON "expenses" USING btree ("store_id","spent_on");--> statement-breakpoint
CREATE INDEX "gift_card_ledger_card" ON "gift_card_ledger" USING btree ("store_id","gift_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_store_code" ON "gift_cards" USING btree ("store_id","code");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_customer" ON "loyalty_ledger" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_serials_unique" ON "product_serials" USING btree ("store_id","product_id","serial");--> statement-breakpoint
CREATE INDEX "product_serials_serial" ON "product_serials" USING btree ("store_id","serial");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_unique" ON "stock_batches" USING btree ("store_id","product_id","branch_id","batch_no",coalesce("expires_on", '9999-12-31'));--> statement-breakpoint
CREATE INDEX "stock_batches_expiry" ON "stock_batches" USING btree ("store_id","expires_on");