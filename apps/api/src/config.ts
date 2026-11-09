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
  /** Restricted role used for all requests, so row-level security always applies. */
  appDatabaseUrl: env("DATABASE_URL", "postgres://lalcha_app:lalcha_dev@localhost:5432/lalcha_dev"),
  /** Stores live at <subdomain>.<baseDomain>. */
  baseDomain: env("BASE_DOMAIN", "localhost"),
  otpPepper: env("OTP_PEPPER", "local-development-only"),
  /** Protects the platform admin page. Use a long random value in production. */
  platformKey: env("PLATFORM_KEY", "local-platform-key"),
  /** Separate role that may read across stores, limited to subscription data. */
  platformDatabaseUrl: env("PLATFORM_DATABASE_URL", "postgres://lalcha_platform:lalcha_dev@localhost:5432/lalcha_dev"),
  /** Numbers shown to owners for subscription payments. Billing is off until these are set. */
  billingPayTo:
    process.env.BILLING_BKASH && process.env.BILLING_NAGAD
      ? { bkash: process.env.BILLING_BKASH, nagad: process.env.BILLING_NAGAD }
      : isProduction
        ? null
        : { bkash: "DEV-BKASH-NUMBER", nagad: "DEV-NAGAD-NUMBER" },
  port: Number(process.env.API_PORT ?? 8787),
  host: process.env.HOST ?? "127.0.0.1",
};
