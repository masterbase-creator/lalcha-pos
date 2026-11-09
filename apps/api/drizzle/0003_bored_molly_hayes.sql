CREATE TABLE "customer_payments" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"method" text NOT NULL,
	"ref" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "customer_payments_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"store_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"qty" integer NOT NULL,
	"value_poisha" bigint NOT NULL,
	"cost_poisha" bigint NOT NULL,
	"restocked" boolean NOT NULL,
	CONSTRAINT "sale_return_lines_store_id_return_id_line_no_pk" PRIMARY KEY("store_id","return_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"customer_id" uuid,
	"value_poisha" bigint NOT NULL,
	"credit_poisha" bigint NOT NULL,
	"refund_poisha" bigint NOT NULL,
	"refund_method" text NOT NULL,
	"refund_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "sale_returns_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "cost_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_store_id_created_by_users_store_id_id_fk" FOREIGN KEY ("store_id","created_by") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_store_id_return_id_sale_returns_store_id_id_fk" FOREIGN KEY ("store_id","return_id") REFERENCES "public"."sale_returns"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_store_id_sale_id_line_no_sale_lines_store_id_sale_id_line_no_fk" FOREIGN KEY ("store_id","sale_id","line_no") REFERENCES "public"."sale_lines"("store_id","sale_id","line_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_store_id_sale_id_sales_store_id_id_fk" FOREIGN KEY ("store_id","sale_id") REFERENCES "public"."sales"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_store_id_created_by_users_store_id_id_fk" FOREIGN KEY ("store_id","created_by") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_payments_customer" ON "customer_payments" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_store_phone" ON "customers" USING btree ("store_id","phone");--> statement-breakpoint
CREATE INDEX "customers_store_name" ON "customers" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "sale_returns_sale" ON "sale_returns" USING btree ("store_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_returns_store_date" ON "sale_returns" USING btree ("store_id","created_at");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_store_customer" ON "sales" USING btree ("store_id","customer_id");
--> statement-breakpoint
UPDATE "sale_lines" l SET "cost_poisha" = p."cost_poisha" FROM "products" p WHERE p."store_id" = l."store_id" AND p."id" = l."product_id";
