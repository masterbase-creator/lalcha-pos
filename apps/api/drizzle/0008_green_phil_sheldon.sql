ALTER TABLE "login_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signup_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "login_codes" CASCADE;--> statement-breakpoint
DROP TABLE "signup_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_store_email" ON "users" USING btree ("store_id","email");