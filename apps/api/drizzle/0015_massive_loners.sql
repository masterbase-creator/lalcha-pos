CREATE TABLE "open_orders" (
	"store_id" uuid NOT NULL,
	"key" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"table_name" text,
	"order_type" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"lines" jsonb NOT NULL,
	"sent" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "open_orders_store_id_key_pk" PRIMARY KEY("store_id","key")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "wholesale_price_poisha" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "daily_rate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "open_orders" ADD CONSTRAINT "open_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;