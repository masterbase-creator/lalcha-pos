-- Re-run after every migration. Safe to apply repeatedly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lalcha_app') THEN
    -- Local development password only; production sets its own role and secret.
    CREATE ROLE lalcha_app LOGIN PASSWORD 'lalcha_dev';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lalcha_platform') THEN
    -- Local development password only. Production needs its own role and secret.
    CREATE ROLE lalcha_platform LOGIN BYPASSRLS PASSWORD 'lalcha_dev';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO lalcha_platform;
GRANT SELECT ON stores TO lalcha_platform;
GRANT SELECT (store_id, id, name, phone, role) ON users TO lalcha_platform;
GRANT SELECT, UPDATE ON subscriptions, subscription_payments TO lalcha_platform;

GRANT USAGE ON SCHEMA public TO lalcha_app;
GRANT SELECT, INSERT ON stores TO lalcha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON signup_codes TO lalcha_app;
-- No UPDATE: a store can't extend its own subscription or mark its own payment approved.
GRANT SELECT, INSERT ON subscriptions, subscription_payments TO lalcha_app;
GRANT SELECT, INSERT, UPDATE ON products, users, devices, sessions, suppliers, purchases, customers, store_settings, shifts TO lalcha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_codes TO lalcha_app;
-- No UPDATE or DELETE: sales records and the stock ledger are append-only.
GRANT SELECT, INSERT ON stock_ledger, sales, sale_lines, purchase_lines, supplier_payments, customer_payments, sale_returns, sale_return_lines, purchase_returns, purchase_return_lines TO lalcha_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'stock_ledger', 'sales', 'sale_lines', 'users', 'login_codes', 'devices', 'sessions', 'suppliers', 'purchases', 'purchase_lines', 'supplier_payments', 'customers', 'customer_payments', 'sale_returns', 'sale_return_lines', 'subscriptions', 'subscription_payments', 'store_settings', 'purchase_returns', 'purchase_return_lines', 'shifts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS store_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY store_isolation ON %I
         USING (store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid)
         WITH CHECK (store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
