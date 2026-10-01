# Rajdanga Fabric — inventory + warehouse portal

One Next.js app that replaces the planned Google Sheet **and** the warehouse (rack) prototype.
It is the source of truth for fabric; Carbonwork is the check against it.

- **Stack:** Next.js 15 (App Router, server actions) · PostgreSQL (Neon or Supabase) · Drizzle ORM · Auth.js with Google sign-in · Tailwind.
- **Kg is stored as whole grams**, so totals never drift.
- **Every rule is checked on the server** inside one database transaction, behind a single "one post at a time" lock. The browser is never trusted.

---

## Using the app (quick guide)

- **Menu.** The menu has five colour-coded sections, laid out in the order the work happens:
  1. **Receive** (blue): receive, incoming POs, print labels, activate labels, put away.
  2. **Move & use** (green): plan a TROR, pick a TROR, take out for production, TROC, move between racks, adjust a roll.
  3. **Check & approve** (purple): count a rack, approve adjustments, Carbonwork check, Zoho prompt.
  4. **Stock & history**.
  5. **Setup**.
- **Shrinking the menu.** The arrow at the bottom (or **Ctrl B**) shrinks the menu to icons. It stays that way until you change it.
- **Bell.** The bell next to Dashboard lists what is waiting: approvals, labels, put-away, overdue counts, TOs not in Zoho, and health-check problems.
- **Find (Ctrl K, or /).** Find searches everything from any page:
  - Symbols and spaces don't matter (`ct26po48` finds CT26/PO/48), and a bare number finds a TO (`12` finds TROC-012).
  - Narrow it with `roll:` `fab:` `to:` `rack:` `po:` `style:` `batch:` `loc:` or `#order`.
  - Filter rolls with `kg<5`, `kg>20`, `at:Exim`, `at:R2-A`, `in:awaiting`.
  - Use the arrow keys to move, Enter to open and Tab to change scope. A preview shows on the right, and recent picks are remembered.
- **Tables.** Every Stock & History table works the same way:
  - Search it (press /), click a column header to sort, and filter by values.
  - Choose which columns show. Kg totals update with your filters.
  - Download a CSV of exactly the rows you see, or click a row to open it.
- **Barcode button.** Every box that takes a code has a barcode button (or press **F2** in it). Press it and the box lights up blue, ready for the USB scanner. The hint under it says which part of a code it wants.

## Floor flows (v2)

**Barcodes.** Roll labels carry `SERIAL|INVOICE|BATCH` in one Code 128 (e.g. `55A-0042|RSWM-0881|B-CT26PO48-55A-01`). Each scan box keeps only the part it needs, so one label works everywhere. Your pre-printed **SKU barcodes** (fabric group + colour) go in Fabric/SKU boxes; a roll label scanned into a fabric box (or an SKU into a roll box) is refused with a message. Test-print a few roll labels: the longer barcode is denser on the 75 mm label.

**Receiving.**
- The office loads what each fabric PO brings into **Incoming POs**: manually, by CSV (Zoho / Carbonwork exports), or automatically with `POST /api/sync/pos` + `Authorization: Bearer $PO_API_KEY`.
- The receiver scans the PO, types the **invoice # (required)**, then scans each fabric's SKU barcode. A fabric that isn't on the PO turns red at once. Nothing is filled in for them.
- *Weighed by* is the signed-in person. Each receiving gets a receipt number (GRN-…), and a PO can arrive in several parts with different invoices. Going over the PO by more than the setting (10%) asks for confirmation.
- A login can be locked to one receiving location (Users → *Receives fabric only at*). `rajdanga@carbontree.com` is set to Rajdanga Storage.

**Fabric repository** (Setup). Fabric group × colour = one item, and the colour is unique inside a group. The Fabric # and SKU are suggested as you type the colour; you can always type your own:
- Single Jersey takes the next number (55).
- The same colour in the paired Rib group ("Fabric 8D2" ↔ "Fabric 8D2 Rib") takes 55B. A Rib added first gives the Single Jersey the plain number later.
- Other letters (55A, 55C …) are manual.

**Take out → TROC.**
- Before cutting, the warehouse takes rolls out on **Take out for production** (production with a style PO, or sampling). The oldest rolls are listed first; tap one to see its rack and room. Picking a newer roll asks "oldest first?".
- The roll leaves its rack and shows as *taken out*.
- The TROC is made by scanning those roll labels, one row per roll; the invoice and batch come with each roll.
- If an order number was already used for the same fabric on an earlier TROC, a popup asks whether it's a recut. Yes saves it as `#CT10231_recut` (then `_recut2` …).

**TROR (office → warehouse, no double logging).**
1. *Plan* — the office makes the TROR (Plan a transfer). It gets its number and a PDF with a barcode and the oldest rolls suggested. No stock moves, and the kg are reserved against other open TRORs.
2. *Pick* — the warehouse scans the TROR barcode on **Pick a TROR**, then each roll as it leaves the rack. Every scan is checked:
   - the right fabric is on the TROR (any batch is fine);
   - the row still needs kg;
   - the roll is at the source, in stock, and not taken out elsewhere.
   A roll bigger than what's left asks *cut or send whole*. Picked rolls are locked to the TROR.
3. *Dispatch* — stock moves once, under the same TROR number. A short dispatch needs a reason; cancel releases the rolls.

**Invoices** (Stock & history). For every vendor invoice: received, used (TROC), sent, left and where it is, with its rolls and movements.

- **Speed.** `npm run local -- --fast` builds the app once (about a minute) and then serves it like the live site, so pages open in well under a second. Plain `npm run local` is for changing code.

## Neon

`neon-setup.cmd` runs the Neon steps in order:

1. Install the CLI and sign in.
2. Add the skills.
3. Add the MCP.
4. Link project `hidden-meadow-96830760` (production branch).
5. Run `neon config init`.
6. Write `neon.ts` and `hello.ts` (templates in `neon-setup/`).
7. Run `neon deploy`.

Run it from this folder in a Windows terminal. After linking, put the project's connection strings in `.env` (DATABASE_URL pooled, DIRECT_URL direct), then run `npm run db:migrate` and `npm run seed`.

---

## 1. What maps to what (your Google Sheet → this app)

| Sheet (Fabric menu / tab) | In the app |
|---|---|
| Receive fabric PO (register rolls) | **Receive fabric PO**: one PO, several fabrics, optional batch, a weights grid (Enter = next roll), challan, note. Max 80 kg per roll. Auto batch `B-<PO>-<Fabric #>-<nn>`. |
| Print labels / Labels tab | **Print labels**: Code 128 PDF. A label stays in the queue until it is scanned in. |
| Activate labels (scan) | **Activate labels**: scan list + queue, then activate together. **At Rajdanga Storage you don't need it: the put-away scan activates the label.** |
| New transfer order (TROR) | **Transfer order · TROR**: Zoho-style item rows (Fabric # or SKU + kg). Oldest rolls first. If the kg ends inside a roll it is **cut**: the piece gets a new serial and label. Live **pick list with racks**. Optional **Scan rolls** mode for the exact rolls that went. |
| New consumption order (TROC) | **Consumption · TROC**: style PO, kg used + waste per row, **pieces and order numbers per row** (Copy piece 1 to all). Kg is taken from the oldest rolls. |
| One shared TROR/TROC number series | Same: `TROR-001, TROC-002 …`, given on post. A reversal takes the next number. |
| Adjust a roll / Approve adjustments | Same rules: smaller of 2 kg / 5 % of the roll needs Admin approval, a note for "Other" and big changes, you can't decide your own. ID `ADJ-yyMMdd-####`. |
| Find | **Find**: a fabric (stock by location + last movements), roll, rack, TO (with Reverse/Undo), or customer order number. |
| Zoho prompt for TROs / Zoho Prompt tab | **Zoho prompt**: TRO numbers, a bare number, or ALL not yet in Zoho → a prompt for Claude + the Zoho connector, with a Copy button. |
| Spot check against Carbonwork | **Spot check**: `fabric_stock_*.csv` (fabric, colour, location, here_kg), OK / Check / Only in Carbonwork / Only in app, random rolls to weigh, Check History. Optional ledger file for a TRO match. |
| Dashboard | **Dashboard**: the same KPIs, the Find fabric finder (location, group, SKU, Fabric #, search), stock by location, recent postings, consumption by style PO and fabric — plus big buttons for the floor. |
| Rolls · TO Log · Order Links · Adjustments · Audit · Check History | Pages of the same name, with CSV export. |
| Fabric Inventory · Locations · Users · Settings · Formats | Admin pages + **Formats** (with your "Your format" notes). Locations add the **Office** type. Users take style-PO **prefixes**. |
| Admin: rebuild balances, demo data, backup + health | **Admin → Tools**. Backup 11 pm and health check 8 am run by themselves (Vercel Cron). |
| Serial Registry | Kept: a serial is never issued twice, even if a roll row is ever removed. |

**Warehouse (from the prototype):** Rack map (Rolls + 3D), rack page, Put away, Move, Count, Counts, Movement log, Admin → Racks.

## 2. Things done once, not twice

- **Put away = label activation** at Rajdanga Storage (one scan places the roll and puts it In stock; also for cut pieces).
- **Transfers update the racks by themselves**: rolls leaving Rajdanga Storage come off their racks; arrivals show as Unplaced with "Put back on R2-A" when they come back. The order form shows each roll's rack, so the floor picks exactly those.
- **Consumption lowers kg in place**; a roll at 0 kg comes off its rack.
- The **Zoho prompt** lets Claude key the TROs into Zoho with the same numbers.

## 3. Rules enforced on every post

Production locations: nothing is received there, moved from there, or transferred to there — fabric going to production is a TROC. Fabric PO, style PO and Fabric # formats (see Formats). Date today or earlier. Source location must be one you may post from. Enough labelled stock at the source (it tells you how much more is waiting for labels). One order number per piece. Nothing is ever deleted: wrong posts are reversed under the next number; non-admins may reverse their own within 10 minutes (Settings), the admin any time; a transfer can't be reversed once its rolls moved again or a cut piece was used.

## 4. Set up (about 30 minutes, once)

### a) Database — Neon (free tier is enough)
1. Create a project at neon.tech in the region nearest India (e.g. *Asia Pacific – Singapore*).
2. Copy the **pooled** connection string into `DATABASE_URL` and the **direct** one into `DIRECT_URL`.

### b) Google sign-in
1. Google Cloud Console → *APIs & Services* → *OAuth consent screen*: set it to Internal (Workspace) or External and add your users.
2. *Credentials* → *Create credentials* → *OAuth client ID* → **Web application**.
3. Authorised redirect URIs:
   - `https://YOUR-APP.vercel.app/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (for local testing)
4. Put the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### c) Run it locally
```bash
npm install
cp .env.example .env          # fill in the values
npx auth secret               # writes AUTH_SECRET
npm run db:migrate            # creates the tables
npm run seed                  # starter locations, the 8 racks (R1-A … R4-B), first admin
npm run dev                   # http://localhost:3000
```

### d) Deploy to Vercel
1. Push this folder to a private GitHub repo and import it in Vercel.
2. Add every variable from `.env.example` under *Settings → Environment Variables*. **Don't** set `DEV_LOGIN` on production.
3. Deploy, then run `npm run db:migrate` once against the production database (locally, with the production `DIRECT_URL`).
4. The crons in `vercel.json` run by themselves: backup at 23:00 IST and health check at 08:00 IST.

### e) The test copy (step 4 of the rollout)
Create a **second** Neon database and a second Vercel project (or run it locally) with `APP_ENV=test`. Then:
```bash
APP_ENV=test npm run seed:demo    # the sheet's demo data (990A … 992, TROR-001 … TROR-011) on the racks, plus test users
```
Locally, `DEV_LOGIN=true` lets you sign in as `inventory@test.local`, `merch@test.local` or `viewer@test.local` without Google. A yellow **TEST COPY** badge shows in the header.

---

## 5. Go-live checklist (from the plan)

1. **Masters.** Import the Zoho items CSV into *Fabric inventory*. Fill **Rajdanga Fabric #** and **Carbonwork code + colour** (use the "only missing" filter). Import locations and set "Name in Carbonwork" wherever the spelling differs. Add style POs and users.
2. **Racks.** They're already seeded as R1-A … R4-B, and you can edit them under *Admin → Racks*. Print the rack labels from the same page.
3. **Opening stock, one location at a time.** The inventory person weighs every roll and registers it. You print the labels in the office. At Rajdanga the labels are stuck on and scanned in **Put away**. Switch on batch tracking for fabric items in Zoho.
4. **From then on:** post every move here first, then key the same TRO into Zoho and tick *Entered in Zoho*. The 8 am health check lists TOs not ticked after 2 days.
5. **Spot check** one week in, then weekly on a random day.

## 6. Carbonwork files (Part 1 — the `stockdesk` snapshot)

The check reads the files the daily snapshot writes to `stock-desk\output\fabric\`:

- `fabric_stock_YYYY-MM-DD.csv`: one row per fabric × colour × location. Required columns (names are matched loosely): **fabric_code, colour, location, kg_here**. Optional: kg_free, kg_incoming, eta.
- `fabric_ledger_YYYY-MM-DD.csv`: any columns. Every `TRO-###` found in the file is matched against the TO Log.

Flags: **OK** (within ±2 kg or 1%, configurable) · **Check** · **Only in Carbonwork** · **Only in app**, sorted biggest gap first. If TOs were posted after the file's date, the page warns that those moves can show up as gaps.

## 7. Open questions from the plan, now settings

*Admin → Settings*: adjustment approval limit (2 kg / 5%, smaller or larger), label size in mm, order-number format (a regular expression; the default accepts `#1234`, internal numbers and `STOCK`), undo window, check tolerance, low-stock amber level, and the rack-full %.
Still for you to decide: which merchandisers get which style POs and locations (*Users*), and whether Zoho lets you switch on batch tracking for items that already hold stock.

## 8. Tests

- `tests/e2e-flows.mjs`: 86 end-to-end checks in a real browser on the demo data: every page; receive against a known PO (invoice required, wrong fabric flagged, GRN, Rajdanga-only login); full roll barcodes in scan boxes; TROR plan → scan → pick with a cut → dispatch under one number; take out FIFO + locator; TROC by roll with the recut popup; invoice page; undo; find; Zoho prompt; permissions; health re-derivation; remove and reload demo.
- `tests/repo-check.ts`: the fabric repository numbering rules (55 / 55B, unique colours, manual numbers).
  Run it with `DATABASE_URL=... node tests/e2e-flows.mjs` (needs `npm i -D playwright pg` and the server running with `DEV_LOGIN=true`).
- Every morning the health check re-works out every roll's kg and location from the logs (including cut pieces) and flags any mismatch in red.

## 9. Keeping secrets out of GitHub

- Real values live only in `.env` (git-ignored) and in Vercel / Neon settings. `.env.example` has empty placeholders.
- `npm install` turns on a **pre-commit hook** (`.githooks/pre-commit` → `scripts/check-secrets.mjs`). It stops a commit that contains a database URL with a password, Google/Neon/GitHub/AWS/AI keys, private keys, or `.env` / `.neon` / `.zip` files.
- `npm run check:secrets` checks every tracked file. GitHub runs the same check plus TruffleHog on every push (`.github/workflows/secret-scan.yml`).
- If a secret ever gets pushed: rotate it first (new Neon password, new Google client secret, `npx auth secret`), then clean the history.

## 10. Later option (from the plan)
Create the TO and adjustment in Zoho Inventory through Zoho's API when you post here. That removes the double entry and keeps the TRO number identical. All posting goes through `src/lib/posting.ts`, so it's one hook to add once the Zoho API connection is set up.
