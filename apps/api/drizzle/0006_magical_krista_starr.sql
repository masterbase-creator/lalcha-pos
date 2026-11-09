CREATE TABLE "purchase_return_lines" (
	"store_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "purchase_return_lines_store_id_return_id_line_no_pk" PRIMARY KEY("store_id","return_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"value_poisha" bigint NOT NULL,
	"credit_poisha" bigint NOT NULL,
	"cash_back_poisha" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "purchase_returns_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"float_poisha" bigint NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"expected_poisha" bigint,
	"counted_poisha" bigint,
	CONSTRAINT "shifts_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
DROP INDEX "purchases_supplier_invoice";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit_poisha" bigint;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "baki_paid_method" text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_store_id_purchase_id_purchases_store_id_id_fk" FOREIGN KEY ("store_id","purchase_id") REFERENCES "public"."purchases"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_store_id_supplier_id_suppliers_store_id_id_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "public"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_store_id_opened_by_users_store_id_id_fk" FOREIGN KEY ("store_id","opened_by") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_returns_purchase" ON "purchase_returns" USING btree ("store_id","purchase_id");--> statement-breakpoint
CREATE INDEX "shifts_store_opened" ON "shifts" USING btree ("store_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_supplier_invoice" ON "purchases" USING btree ("store_id","supplier_id","invoice_no") WHERE status not in ('cancelled', 'voided');