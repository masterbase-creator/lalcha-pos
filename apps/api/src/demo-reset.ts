// Wipes the public demo store and loads the sample data again. Run it on a schedule, for example every hour from cron.
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "./config.ts";
import { seedStore, stableUuid } from "./demo-data.ts";

if (config.demoSubdomain !== "demo") throw new Error("Set DEMO_SUBDOMAIN=demo to use the public demo");

const storeId = stableUuid("store:demo");
const client = postgres(config.adminDatabaseUrl, { max: 1, onnotice: () => {}, ...(config.adminDatabaseHost ? { host: config.adminDatabaseHost } : {}) });

await client.begin(async (sql) => {
  // Every table that holds store data has a store_id column. Foreign keys are paused only inside this transaction.
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'store_id' and table_name <> 'stores'`;
  await sql`set local session_replication_role = replica`;
  for (const { table_name } of tables) await sql`delete from ${sql(table_name)} where store_id = ${storeId}`;
});

// Photos uploaded to the demo store are removed too. The shared sample pictures sit outside its folder.
await rm(fileURLToPath(new URL(`../public/products/${storeId}/`, import.meta.url)), { recursive: true, force: true });

await seedStore(drizzle(client), "demo", "Demo Super Shop", { withPhones: false, imageDir: new URL("../public/products/", import.meta.url) });
await client.end();
console.log("Demo store reset.");
