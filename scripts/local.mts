/**
 * npm run local  →  try the app on this PC with the demo data. No database account needed.
 *
 * Starts a private Postgres that lives in your user folder (outside OneDrive),
 * creates the tables, loads the sheet's demo data the first time, then runs the app
 * at http://localhost:3000 with Dev sign-in switched on.
 *
 * Ctrl+C stops both. Your demo data stays for next time.
 * Start over: npm run local -- --reset
 * Fast mode (pages open instantly, like the live site): npm run local -- --fast
 *   builds the app once (about a minute), then serves the built version. Use it to try the app;
 *   use the normal mode while changing code.
 */
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";

const PORT = 5433;
const DIR = process.env.LOCAL_DB_DIR || join(homedir(), ".rajdanga-fabric-localdb");
const URL = `postgresql://postgres:postgres@localhost:${PORT}/rajdanga`;

if (process.argv.includes("--reset") && existsSync(DIR)) {
  rmSync(DIR, { recursive: true, force: true });
  console.log("Local test data wiped.");
}

const pgServer = new EmbeddedPostgres({ databaseDir: DIR, user: "postgres", password: "postgres", port: PORT, persistent: true, onLog: () => {} });
const fresh = !existsSync(join(DIR, "PG_VERSION"));
if (fresh) { console.log("Setting up the local test database (first time only)…"); await pgServer.initialise(); }
await pgServer.start();
if (fresh) await pgServer.createDatabase("rajdanga");

const admin = (process.env.ADMIN_EMAILS || "").split(",")[0]?.trim() || "shantanu@carbontree.com";
const env = {
  ...process.env,
  DATABASE_URL: URL,
  DIRECT_URL: URL,
  APP_ENV: "test",
  DEV_LOGIN: "true",
  ADMIN_EMAILS: process.env.ADMIN_EMAILS || admin,
  AUTH_SECRET: process.env.AUTH_SECRET || randomBytes(32).toString("base64url"),
  CRON_SECRET: process.env.CRON_SECRET || "dev-cron",
  AUTH_URL: "http://localhost:3000",
  AUTH_TRUST_HOST: "true",
};

const run = (cmd: string, args: string[]) =>
  new Promise<void>((ok, bad) => {
    const p = spawn(cmd, args, { env, stdio: "inherit", shell: process.platform === "win32" });
    p.on("exit", (c) => (c === 0 ? ok() : bad(new Error(`${cmd} ${args.join(" ")} failed (${c})`))));
  });

let next: ReturnType<typeof spawn> | undefined;
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  next?.kill();
  await pgServer.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

try {
  await run("npx", ["tsx", "scripts/migrate.mts"]);
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  const { rows } = await c.query("select count(*)::int n from transfer_orders");
  await c.end();
  if (rows[0].n === 0) {
    console.log("Loading the demo data…");
    await run("npx", ["tsx", "--conditions=react-server", "scripts/seed.ts", "--demo"]);
  }
  console.log(`\n  Open http://localhost:3000 and use "Dev sign in" with ${admin}`);
  console.log("  (or inventory@test.local · merch@test.local · viewer@test.local)\n");
  if (process.argv.includes("--fast")) {
    console.log("Building the fast version (about a minute)…");
    await run("npx", ["next", "build"]);
    next = spawn("npx", ["next", "start", "-p", "3000"], { env: { ...env, NODE_ENV: "production" }, stdio: "inherit", shell: process.platform === "win32" });
  } else {
    next = spawn("npx", ["next", "dev"], { env, stdio: "inherit", shell: process.platform === "win32" });
  }
  next.on("exit", stop);
} catch (e) {
  console.error(e);
  await pgServer.stop().catch(() => {});
  process.exit(1);
}
