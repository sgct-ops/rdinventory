#!/usr/bin/env node
/**
 * Stops secrets getting into git.
 *   node scripts/check-secrets.mjs            → checks the files staged for the next commit (the pre-commit hook runs this)
 *   node scripts/check-secrets.mjs --all      → checks every tracked file (CI runs this)
 *   node scripts/check-secrets.mjs --install-hook → points git at .githooks (npm install does this for you)
 * Real values belong in .env (ignored) or in Vercel / Neon project settings — never in the repo.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const git = (...a) => { try { return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };

if (process.argv.includes("--install-hook")) {
  if (git("rev-parse", "--is-inside-work-tree")?.trim() === "true") git("config", "core.hooksPath", ".githooks");
  process.exit(0);
}

const all = process.argv.includes("--all");
const list = all ? git("ls-files", "-z") : git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z");
if (list === null) { console.log("check-secrets: not a git repo, skipped"); process.exit(0); }
const files = list.split("\0").filter(Boolean);

const BAD_FILES = [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, /\.pem$/, /\.p12$/, /\.pfx$/, /(^|\/)id_(rsa|ed25519)$/, /(^|\/)\.neon\//, /service-account.*\.json$/i, /\.zip$/];
const RULES = [
  ["Postgres URL with a password", /postgres(?:ql)?:\/\/[^:\s"'`/@]+:([^@\s"'`]{4,})@([^\s"'`/:]+)/g, (m) => !/^(PASSWORD|password|postgres|\$\{)/.test(m[1]) && !/^(localhost|127\.0\.0\.1|HOST)$/.test(m[2])],
  ["Google OAuth client secret", /GOCSPX-[A-Za-z0-9_-]{20,}/g],
  ["Neon API key", /\bnapi_[A-Za-z0-9]{30,}/g],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Anthropic / OpenAI key", /\bsk-(ant-)?[A-Za-z0-9_-]{30,}/g],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{20,}/g],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["Secret assigned in code", /\b(AUTH_SECRET|AUTH_GOOGLE_SECRET|CRON_SECRET|PO_API_KEY|NEON_API_KEY|DATABASE_URL|DIRECT_URL)\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/g, (m) => !/^(postgresql:\/\/USER|\$\{)/.test(m[2])],
];

const problems = [];
for (const f of files) {
  if (BAD_FILES.some((r) => r.test(f))) { problems.push(`${f}: this kind of file must not be committed (add it to .gitignore)`); continue; }
  let text;
  try { text = all || !git("show", `:${f}`) ? (existsSync(f) ? readFileSync(f, "utf8") : "") : git("show", `:${f}`); } catch { continue; }
  if (!text || text.includes("\0") || text.length > 2_000_000) continue;
  if (/\/\/ check-secrets: allow-file/.test(text)) continue;
  for (const [name, re, ok] of RULES) for (const m of text.matchAll(re)) {
    if (ok && !ok(m)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    if (/check-secrets: allow/.test(text.split("\n")[line - 1])) continue;
    problems.push(`${f}:${line}: looks like a ${name}`);
  }
}
if (problems.length) {
  console.error("\n✖ Possible secrets — commit stopped:\n  " + problems.join("\n  "));
  console.error("\nMove the value to .env (it is git-ignored) or to Vercel/Neon settings. If it really is harmless, add the comment  check-secrets: allow  on that line.\n");
  process.exit(1);
}
console.log(`check-secrets: ${files.length} file(s) clean`);
