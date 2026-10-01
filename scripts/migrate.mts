import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url || /@HOST\//.test(url)) {
  console.error("No database set. Put your Neon connection strings into DATABASE_URL and DIRECT_URL in .env (see README 4a), or run: npm run local");
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
console.log("Migrations applied");
await pool.end();
