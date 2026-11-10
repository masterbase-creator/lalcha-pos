import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "./config.ts";
import { seedStore } from "./demo-data.ts";

if (config.isProduction) throw new Error("Sample data must never be loaded into production");

const client = postgres(config.adminDatabaseUrl, { max: 1, onnotice: () => {}, ...(config.adminDatabaseHost ? { host: config.adminDatabaseHost } : {}) });
const db = drizzle(client);

await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await client.unsafe(readFileSync(new URL("./rls.sql", import.meta.url), "utf8"));

const imageDir = new URL("../public/products/", import.meta.url);
await seedStore(db, "demo", "Demo Super Shop", { withPhones: true, imageDir });
await seedStore(db, "other", "Other Store", { withPhones: true, imageDir });

await client.end();
console.log("Database ready: migrations, access rules and sample data applied.");
