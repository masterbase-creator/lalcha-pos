CREATE TABLE "devices" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"paired_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"store_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "login_codes_store_id_phone_pk" PRIMARY KEY("store_id","phone")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"store_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_store_id_token_hash_pk" PRIMARY KEY("store_id","token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text NOT NULL,
	"pin_hash" text NOT NULL,
	"pin_failed" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "cashier_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD COLUMN "actor_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_store_id_paired_by_users_store_id_id_fk" FOREIGN KEY ("store_id","paired_by") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_store_id_user_id_users_store_id_id_fk" FOREIGN KEY ("store_id","user_id") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_store_id_device_id_devices_store_id_id_fk" FOREIGN KEY ("store_id","device_id") REFERENCES "public"."devices"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_store_token" ON "devices" USING btree ("store_id","token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_store_phone" ON "users" USING btree ("store_id","phone");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_cashier_id_users_store_id_id_fk" FOREIGN KEY ("store_id","cashier_id") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_store_id_actor_id_users_store_id_id_fk" FOREIGN KEY ("store_id","actor_id") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;