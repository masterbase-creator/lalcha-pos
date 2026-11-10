import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, sku TEXT NOT NULL, barcode TEXT, name_en TEXT NOT NULL, name_bn TEXT NOT NULL,
    category TEXT NOT NULL, price_poisha INTEGER NOT NULL, image_url TEXT, stock INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sale_queue (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    error TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sale_queue_status ON sale_queue(status, created_at);
  CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS staff_pins (
    user_id TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, iterations INTEGER NOT NULL,
    failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, due_poisha INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, actor_id TEXT NOT NULL, payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', error TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, created_at);
  CREATE TABLE IF NOT EXISTS recent_sales (id TEXT PRIMARY KEY, sold_at TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export type Statement = { sql: string; bind?: (string | number | null)[] };

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  // The public demo keeps nothing between visits, and on-device storage allows only one tab at a time,
  // so the demo in the homepage frame and the full-screen demo in another tab must not share it.
  const db = self.location.hostname.startsWith("demo.")
    ? new sqlite3.oo1.DB(":memory:")
    : new (await sqlite3.installOpfsSAHPoolVfs({ name: "lalcha-pos" })).OpfsSAHPoolDb("/pos.sqlite3");
  db.exec(SCHEMA);
  for (const change of ["ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'pc'", "ALTER TABLE customers ADD COLUMN credit_limit_poisha INTEGER", "ALTER TABLE products ADD COLUMN vat_rate_bp INTEGER", "ALTER TABLE products ADD COLUMN variant_of TEXT", "ALTER TABLE products ADD COLUMN variant_name TEXT", "ALTER TABLE products ADD COLUMN packs TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE products ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'", "ALTER TABLE customers ADD COLUMN points INTEGER NOT NULL DEFAULT 0", "ALTER TABLE staff ADD COLUMN pin_version TEXT"]) {
    try {
      db.exec(change);
    } catch {
      // Already added on this device.
    }
  }
  return db;
})();

self.onmessage = async (e: MessageEvent<{ id: number; statements: Statement[] }>) => {
  const { id, statements } = e.data;
  try {
    const db = await ready;
    db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) =>
        db.exec({ sql: s.sql, bind: s.bind, rowMode: "object", returnValue: "resultRows" }),
      );
      db.exec("COMMIT");
      self.postMessage({ id, results });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
