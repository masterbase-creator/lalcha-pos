CREATE TABLE "purchase_lines" (
	"store_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost_poisha" bigint NOT NULL,
	CONSTRAINT "purchase_lines_store_id_purchase_id_line_no_pk" PRIMARY KEY("store_id","purchase_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"invoice_no" text,
	"purchased_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone,
	"discount_poisha" bigint NOT NULL,
	"total_poisha" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_id" uuid,
	"amount_poisha" bigint NOT NULL,
	"method" text NOT NULL,
	"ref" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "supplier_payments_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "suppliers_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_id_purchase_id_purchases_store_id_id_fk" FOREIGN KEY ("store_id","purchase_id") REFERENCES "public"."purchases"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_store_id_supplier_id_suppliers_store_id_id_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "public"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_store_id_created_by_users_store_id_id_fk" FOREIGN KEY ("store_id","created_by") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_store_id_supplier_id_suppliers_store_id_id_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "public"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_store_id_purchase_id_purchases_store_id_id_fk" FOREIGN KEY ("store_id","purchase_id") REFERENCES "public"."purchases"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_store_id_created_by_users_store_id_id_fk" FOREIGN KEY ("store_id","created_by") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_supplier_invoice" ON "purchases" USING btree ("store_id","supplier_id","invoice_no");--> statement-breakpoint
CREATE INDEX "purchases_store_date" ON "purchases" USING btree ("store_id","purchased_at");--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier" ON "supplier_payments" USING btree ("store_id","supplier_id");--> statement-breakpoint
CREATE INDEX "suppliers_store_name" ON "suppliers" USING btree ("store_id","name");