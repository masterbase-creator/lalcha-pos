// Production schema update: migrations and access rules only, never sample data.
// Run as a database superuser after each deploy, before restarting the API.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "./config.ts";

const client = postgres(config.adminDatabaseUrl, { max: 1, onnotice: () => {}, ...(config.adminDatabaseHost ? { host: config.adminDatabaseHost } : {}) });
await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await client.unsafe(readFileSync(new URL("./rls.sql", import.meta.url), "utf8"));
await client.end();
console.log("Database migrated and access rules applied.");
