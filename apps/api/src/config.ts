const isProduction = process.env.NODE_ENV === "production";

function env(name: string, devDefault: string) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production`);
  return devDefault;
}

export const config = {
  isProduction,
  /** Runs migrations and seeds; bypasses row-level security. Never used to serve requests. */
  adminDatabaseUrl: env("ADMIN_DATABASE_URL", "postgres://localhost:5432/lalcha_dev"),
  /** Optional socket folder (e.g. /var/run/postgresql), so migrations can run as the local postgres user with no password. */
  adminDatabaseHost: process.env.ADMIN_DATABASE_HOST ?? null,
  /** Restricted role used for all requests, so row-level security always applies. */
  appDatabaseUrl: env("DATABASE_URL", "postgres://lalcha_app:lalcha_dev@localhost:5432/lalcha_dev"),
  /** Stores live at <subdomain>.<baseDomain>. */
  baseDomain: env("BASE_DOMAIN", "localhost"),
  otpPepper: env("OTP_PEPPER", "local-development-only"),
  /** The only address that serves the superadmin panel and its API, e.g. admin.lalcha.com. Every other host gets "not found". */
  adminHost: env("ADMIN_HOST", "admin.localhost").toLowerCase(),
  /** Who may sign in to the superadmin panel. Codes go only to these addresses. */
  platformAdmins: env("PLATFORM_ADMIN_EMAILS", "admin@lalcha.test")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  /** Separate role that may read across stores, limited to subscription data. */
  platformDatabaseUrl: env("PLATFORM_DATABASE_URL", "postgres://lalcha_platform:lalcha_dev@localhost:5432/lalcha_dev"),
  /** Numbers shown to owners for subscription payments. Billing is off until these are set. */
  billingPayTo:
    process.env.BILLING_BKASH && process.env.BILLING_NAGAD
      ? { bkash: process.env.BILLING_BKASH, nagad: process.env.BILLING_NAGAD }
      : isProduction
        ? null
        : { bkash: "DEV-BKASH-NUMBER", nagad: "DEV-NAGAD-NUMBER" },
  /** Outgoing mail for login codes, e.g. smtps://user:pass@mail.example.com:465. Codes print to the console without it in development. */
  smtpUrl: process.env.SMTP_URL ?? null,
  mailFrom: process.env.MAIL_FROM ?? "Lalcha POS <hello@lalcha.com>",
  /**
   * Login codes go through a relay with an established reputation (Cloudflare Email Service), from a
   * subdomain set up for it, the way Outclarity sends its notifications. Without a password, codes go
   * through SMTP_URL like everything else.
   */
  codesSmtp: process.env.CODES_SMTP_PASSWORD
    ? {
        host: process.env.CODES_SMTP_HOST ?? "smtp.mx.cloudflare.net",
        port: Number(process.env.CODES_SMTP_PORT ?? 465),
        user: process.env.CODES_SMTP_USER ?? "api_token",
        pass: process.env.CODES_SMTP_PASSWORD,
      }
    : null,
  codesFrom: process.env.CODES_MAIL_FROM ?? "Lalcha POS <hello@notification.lalcha.com>",
  /** The company's own mail domain, and the addresses the superadmin inbox can send from. */
  mailDomain: process.env.MAIL_DOMAIN ?? "lalcha.com",
  mailboxes: (process.env.MAILBOXES ?? "hello,support,billing").split(",").map((m) => m.trim().toLowerCase()).filter(Boolean),
  /** Postal posts incoming mail with this in the URL. The inbound endpoint doesn't exist until it is set. */
  mailWebhookToken: process.env.MAIL_WEBHOOK_TOKEN ?? (isProduction ? null : "local-mail-token"),
  /** The public demo store, reset on a schedule by `pnpm demo:reset`. Off in production unless set. */
  demoSubdomain: process.env.DEMO_SUBDOMAIN ?? (isProduction ? null : "demo"),
  port: Number(process.env.API_PORT ?? 8787),
  host: process.env.HOST ?? "127.0.0.1",
};
