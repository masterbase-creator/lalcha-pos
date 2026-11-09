CREATE TABLE "signup_codes" (
	"phone" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"plan" text NOT NULL,
	"months" integer NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"method" text NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "subscription_payments_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"paid_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_store_id_created_by_users_store_id_id_fk" FOREIGN KEY ("store_id","created_by") REFERENCES "public"."users"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_ref" ON "subscription_payments" USING btree ("method","ref") WHERE status <> 'rejected';