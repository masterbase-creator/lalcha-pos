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
GRANT SELECT (store_id, id, name, phone, email, role, disabled_at) ON users TO lalcha_platform;
GRANT UPDATE (pin_hash, pin_failed, pin_locked_until) ON users TO lalcha_platform;
GRANT UPDATE (suspended_at, support_note) ON stores TO lalcha_platform;
GRANT SELECT (store_id, sold_at) ON sales TO lalcha_platform;
GRANT SELECT (store_id, revoked_at) ON devices TO lalcha_platform;
GRANT SELECT, UPDATE ON sessions TO lalcha_platform;
GRANT SELECT, INSERT ON platform_audit TO lalcha_platform;
GRANT SELECT, UPDATE ON subscriptions, subscription_payments TO lalcha_platform;
GRANT INSERT ON subscription_payments TO lalcha_platform;
-- Superadmin sign-in. The shop app's role gets nothing here, so a store can never read or forge these.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_codes, platform_sessions TO lalcha_platform;
-- The company inbox. Only the superadmin role reads or writes it.
GRANT SELECT, INSERT, UPDATE ON platform_mail TO lalcha_platform;
-- Scheduled cleanup: which photos are still used, and removing expired one-time codes.
GRANT SELECT (image_url) ON products TO lalcha_platform;
GRANT SELECT, DELETE ON login_codes, signup_codes TO lalcha_platform;

GRANT USAGE ON SCHEMA public TO lalcha_app;
GRANT SELECT, INSERT ON stores TO lalcha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON signup_codes TO lalcha_app;
-- No UPDATE: a store can't extend its own subscription or mark its own payment approved.
GRANT SELECT, INSERT ON subscriptions, subscription_payments TO lalcha_app;
GRANT SELECT, INSERT, UPDATE ON products, users, devices, sessions, suppliers, purchases, customers, store_settings, shifts, branches, stock_transfers TO lalcha_app;
-- Batches and serials change state (a piece is sold, a batch is first seen); tables, coupons, cards and expenses are edited or voided, never deleted.
GRANT SELECT, INSERT, UPDATE ON stock_batches, product_serials, restaurant_tables, coupons, gift_cards, expenses TO lalcha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_codes TO lalcha_app;
-- Packs are replaced as a whole when a product is saved.
GRANT SELECT, INSERT, UPDATE, DELETE ON product_packs TO lalcha_app;
GRANT UPDATE (received_qty) ON purchase_lines TO lalcha_app;
-- No UPDATE or DELETE: sales records and the stock ledger are append-only.
GRANT SELECT, INSERT ON stock_ledger, sales, sale_lines, purchase_lines, supplier_payments, customer_payments, sale_returns, sale_return_lines, purchase_returns, purchase_return_lines, purchase_receipts, stock_transfer_lines, audit_log, loyalty_ledger, gift_card_ledger TO lalcha_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_packs', 'stock_ledger', 'sales', 'sale_lines', 'users', 'login_codes', 'devices', 'sessions', 'suppliers', 'purchases', 'purchase_lines', 'supplier_payments', 'customers', 'customer_payments', 'sale_returns', 'sale_return_lines', 'subscriptions', 'subscription_payments', 'store_settings', 'purchase_returns', 'purchase_return_lines', 'shifts', 'branches', 'purchase_receipts', 'stock_transfers', 'stock_transfer_lines', 'audit_log', 'stock_batches', 'product_serials', 'restaurant_tables', 'loyalty_ledger', 'coupons', 'gift_cards', 'gift_card_ledger', 'expenses'] LOOP
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
