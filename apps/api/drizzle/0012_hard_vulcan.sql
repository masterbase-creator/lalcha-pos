CREATE TABLE "platform_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"mailbox" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_address" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"text_body" text DEFAULT '' NOT NULL,
	"html_body" text,
	"message_id" text,
	"in_reply_to" text,
	"references" text,
	"attachments" text,
	"postal_id" text,
	"sent_by" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_mail_postal_id" ON "platform_mail" USING btree ("postal_id");--> statement-breakpoint
CREATE INDEX "platform_mail_created" ON "platform_mail" USING btree ("created_at");