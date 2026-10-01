// End-to-end checks against the demo data (APP_ENV=test, DEV_LOGIN=true). Run: DATABASE_URL=... node tests/e2e-flows.mjs
import { chromium } from "playwright";
import pg from "pg";
const B = process.env.BASE_URL || "http://localhost:3000";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const q1 = async (s, a = []) => (await db.query(s, a)).rows[0];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const check = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { console.log("PAGEERROR", email, p.url(), e.message); fails++; });
  if (process.env.SHOW_CONSOLE) p.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) console.log("CONSOLE-ERR", email, p.url(), m.text().slice(0, 3000)); });
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "e2e reason" : undefined));
  await p.goto(B + "/login"); await p.fill('input[name="email"]', email); await p.click("text=Dev sign in"); await p.waitForURL(B + "/");
  await p.waitForLoadState("networkidle"); // let the page finish hydrating before the next step
  return p;
}
const scan = async (p, code) => { const i = p.locator(".scanbox input").first(); await i.fill(code); await i.press("Enter"); await p.waitForTimeout(800); };
const sel = (p, label) => p.locator(`label:has-text("${label}") + select`).first();

const admin = await login("shantanu@carbontree.com");
const inv = await login("inventory@test.local");
const merch = await login("merch@test.local");
const viewer = await login("viewer@test.local");

// every page opens
for (const path of ["/", "/find?q=990A", "/find?q=%23CT10341", "/find?q=TROC-003", "/receive", "/labels", "/labels/activate", "/to/transfer", "/to/consumption", "/zoho?q=ALL",
  "/warehouse", "/warehouse/put", "/warehouse/move", "/warehouse/count", "/warehouse/counts", "/warehouse/log", "/warehouse/racks/R1-A", "/adjustments/new", "/adjustments",
  "/adjustments/list", "/check", "/rolls", "/log", "/orders", "/audit", "/formats", "/admin/fabrics", "/admin/fabric-groups", "/pos", "/warehouse/takeout", "/to/pick", "/invoices", "/invoices/INV-DEMO-101", "/find?q=INV-DEMO-101", "/admin/locations", "/admin/racks", "/admin/users", "/admin/settings", "/admin/tools"]) {
  const r = await admin.goto(B + path); await admin.waitForLoadState("networkidle"); const t = await admin.locator("body").innerText();
  check(r.status() < 400 && !/Application error|Internal Server Error/.test(t), `page ${path}`);
}

// ---- receive: the PO must be known, invoice is required, fabrics are checked against the PO
const PO = `CT26/PO/${2000 + Math.floor(Math.random() * 7000)}`, POK = PO.replace(/\//g, "");
await db.query(`insert into purchase_orders (id, po_number, vendor, source, created_by) values (gen_random_uuid()::text, '${PO}', 'E2E', 'MANUAL', 'e2e') on conflict do nothing`);
await db.query(`insert into po_lines (id, po_id, fabric_item_id, expected_g, expected_rolls)
  select gen_random_uuid()::text, p.id, f.id, x.g, 2 from purchase_orders p, (values ('990A', 45000), ('991A', 30000)) x(fno, g) join fabric_items f on f.fabric_no = x.fno
  where p.po_number = '${PO}' on conflict do nothing`);
const fab = (p, i) => p.locator(`input[aria-label="Fabric ${i}"]`);
await inv.goto(B + "/receive"); await inv.waitForLoadState("networkidle");
await inv.locator('input[aria-label="Fabric PO"]').fill(PO);
await inv.waitForSelector("text=EXPECTED", { timeout: 8000 }).catch(() => {});
await sel(inv, "Received at").selectOption({ label: "Rajdanga Storage" });
check(await inv.locator("text=signed in").count() > 0, "weighed by is the signed-in user");
await fab(inv, 1).fill("992"); await inv.waitForTimeout(400);
check(await inv.locator("text=/has no 992/").count() > 0, "fabric not on the PO is flagged at once");
await fab(inv, 1).fill("990A");
for (const [j, w] of ["20.5", "21.25"].entries()) { const x = inv.locator(`[data-w="0-${j}"]`); await x.fill(w); await x.press("Enter"); }
await inv.click("text=+ Add another fabric"); await fab(inv, 2).fill("DM-SKU-3D2-CHA");
await inv.locator('[data-w="1-0"]').fill("30");
await inv.click("text=Receive and create rolls"); await inv.waitForTimeout(1000);
check(/invoice # \(required\)|Invoice # is required/i.test(await inv.locator("body").innerText()), "invoice # is required");
await inv.locator('input[aria-label="Invoice number"]').fill("INV-E2E-1");
await inv.click("text=Receive and create rolls"); await inv.waitForSelector("text=/RECEIVED · GRN-/");
const rec = (await db.query(`select r.serial, r.invoice_no, r.weighed_by, b.code from rolls r join batches b on b.id=r.batch_id where r.fabric_po='${PO}' order by r.weighed_g`)).rows;
check(rec.length === 3 && rec.every((r) => r.invoice_no === "INV-E2E-1" && r.weighed_by) && rec.some((r) => r.code === `B-${POK}-990A-01`), "PO received: 3 rolls with invoice, batches " + rec.map((r) => r.code));
check((await q1(`select count(*)::int n from receipts where po_number='${PO}' and invoice_no='INV-E2E-1'`)).n === 1, "receipt (GRN) recorded");
await inv.goto(B + "/receive"); await inv.locator('input[aria-label="Fabric PO"]').fill("CT26/PO/999"); await inv.waitForTimeout(1200);
check(await inv.locator("text=/isn.t in Incoming POs/").count() > 0, "unknown PO is flagged");
await inv.locator('input[aria-label="Fabric PO"]').fill("");
const rj = await login("rajdanga@carbontree.com");
await rj.goto(B + "/receive"); await rj.waitForLoadState("networkidle");
check(await rj.locator("text=fixed for your login").count() > 0 && await rj.locator("text=Rajdanga Storage").count() > 0, "Rajdanga login receives only at Rajdanga Storage");

// put away activates the new labels; a full roll barcode (SERIAL|INVOICE|BATCH) works in the scan box
await inv.goto(B + "/warehouse/put"); await scan(inv, "RK-R4-A");
for (const r of rec) await scan(inv, `${r.serial}|${r.invoice_no}|${r.code}`);
check((await q1(`select count(*)::int n from rolls where fabric_po='${PO}' and status='IN_STOCK' and rack_id is not null`)).n === 3, "put away placed + activated the 3 new rolls (full barcode)");
await inv.goto(B + "/adjustments/new"); await inv.waitForLoadState("networkidle");
await inv.locator('input[data-want="serial"]').fill(`${rec[0].serial}|${rec[0].invoice_no}|${rec[0].code}`); await inv.waitForTimeout(200);
check(await inv.locator('input[data-want="serial"]').inputValue() === rec[0].serial, "serial box keeps only the serial part of a roll barcode");
await inv.locator('input[data-want="serial"]').fill("DM-SKU-3D2-CHA"); await inv.locator('input[data-want="serial"]').press("Enter"); await inv.waitForTimeout(200);
check(await inv.locator('[role=alert]').count() > 0, "SKU scanned into a serial box is refused");

// ---- TROR: office plans → warehouse scans → dispatch (one number, no double posting)
const before = await q1("select coalesce(max(substring(to_number from 6)::int),0) m from transfer_orders");
await admin.goto(B + "/to/transfer"); await admin.waitForLoadState("networkidle");
await sel(admin, "Source location").selectOption({ label: "Rajdanga Storage" });
await sel(admin, "Destination location").selectOption({ label: "Exim" });
await admin.locator('input[aria-label="Item 1"]').fill("990A");
await admin.locator('input[aria-label="Quantity kg"]').first().fill("30");
await admin.waitForTimeout(1500);
await admin.click("button:has-text('Create TROR')"); await admin.waitForSelector("text=TROR CREATED");
const tro = `TROR-${String(before.m + 1).padStart(3, "0")}`;
const planned = await q1("select id, status from transfer_orders where to_number=$1", [tro]);
check(planned?.status === "PLANNED", `${tro} planned, no stock moved yet`);
check((await admin.request.get(B + `/api/to/${planned.id}/pdf`)).headers()["content-type"]?.includes("pdf"), "TROR PDF");
await inv.goto(B + "/to/pick"); await inv.waitForLoadState("networkidle"); await scan(inv, tro); await inv.waitForURL(/\/to\/pick\//, { timeout: 8000 }).catch(() => {});
check(inv.url().includes(planned.id), "scanning the TROR barcode opens it for picking");
const wrong = await q1("select serial from rolls r join fabric_items f on f.id=r.fabric_item_id where f.fabric_no='992' and r.status='IN_STOCK' limit 1");
await scan(inv, wrong.serial);
check(await inv.locator(".bg-badbg").count() > 0, "a roll of the wrong fabric is refused");
const pool = (await db.query(`select r.serial, r.remaining_g g from rolls r join fabric_items f on f.id=r.fabric_item_id join locations l on l.id=r.current_location_id
  where f.fabric_no='990A' and l.name='Rajdanga Storage' and r.status='IN_STOCK' and r.taken_out_at is null order by r.remaining_g desc`)).rows;
let need = 30000;
for (const r of pool) {
  if (need <= 50) break;
  await scan(inv, r.serial);
  if (await inv.locator("[role=dialog][aria-label='Cut this roll?']").count()) { await inv.click("button:has-text('Cut ')"); await inv.waitForTimeout(800); need = 0; }
  else need -= r.g;
}
check((await q1("select count(*)::int n from to_picks p join transfer_orders t on t.id=p.to_id where t.to_number=$1", [tro])).n >= 2, "rolls picked (with a cut)");
await inv.click(`button:has-text('Dispatch ${tro}')`); await inv.waitForSelector("text=DISPATCHED");
check((await q1("select status from transfer_orders where to_number=$1", [tro])).status === "POSTED", `${tro} dispatched under its own number`);
check((await q1("select count(*)::int n from transfer_orders where to_number like 'TROR-%' and substring(to_number from 6)::int > $1", [before.m])).n === 1, "no second TO number was used");
const cut = await q1("select r.serial, l.name from rolls r join locations l on l.id=r.current_location_id where r.notes = $1", [`Cut piece on ${tro}`]);
check(cut && cut.name === "Exim", "cut piece made and moved to Exim " + (cut?.serial ?? ""));
await inv.goto(B + "/to/transfer");
check(!(await sel(inv, "Destination location").innerText()).includes("Rajdanga Production"), "transfer can't go to a production location");

// ---- take out (FIFO) → TROC by roll barcode → recut popup
const oldest = await q1(`select r.serial from rolls r join fabric_items f on f.id=r.fabric_item_id join locations l on l.id=r.current_location_id
  where f.fabric_no='990A' and l.name='Rajdanga Storage' and r.status='IN_STOCK' and r.taken_out_at is null and r.rack_id is not null order by r.registered_date, r.created_at, r.serial limit 1`);
await inv.goto(B + "/warehouse/takeout"); await inv.waitForLoadState("networkidle");
await inv.locator('input[aria-label="Style PO"]').fill("CT26/PO/88");
await inv.locator('input[aria-label="Fabric to take out"]').fill("990A"); await inv.waitForTimeout(1500);
check(await inv.locator("text=FIRST").count() > 0, "take-out shows the oldest roll first");
await inv.locator("button[title^='Where is']").first().click(); await inv.waitForTimeout(1200);
check(await inv.locator("[role=dialog] >> text=RACK").count() > 0, "clicking a pick-list roll shows its rack and room");
await inv.keyboard.press("Escape");
await scan(inv, oldest.serial);
const out = await q1("select taken_out_purpose p, taken_out_for f, rack_id from rolls where serial=$1", [oldest.serial]);
check(out.p === "PRODUCTION" && out.f === "CT26/PO/88" && !out.rack_id, "roll taken out for CT26/PO/88 and off its rack");
await merch.goto(B + "/to/consumption"); await merch.waitForLoadState("networkidle");
await sel(merch, "From").selectOption({ label: "Rajdanga Storage" });
await merch.locator('input[aria-label="Style PO"]').fill("CT26/PO/88");
const onRack = await q1("select serial from rolls where status='IN_STOCK' and taken_out_at is null and rack_id is not null limit 1");
await merch.locator('input[aria-label="Roll 1"]').fill(onRack.serial); await merch.locator('input[aria-label="Roll 1"]').press("Enter"); await merch.waitForTimeout(1000);
check(await merch.locator("text=hasn't been taken out").count() > 0, "TROC refuses a roll that wasn't taken out");
await merch.locator('input[aria-label="Roll 1"]').fill(oldest.serial); await merch.locator('input[aria-label="Roll 1"]').press("Enter"); await merch.waitForTimeout(1200);
check(await merch.locator("text=/Invoice .* batch/").count() > 0, "TROC row shows the roll's invoice and batch");
await merch.locator('input[aria-label="Kg used"]').first().fill("2");
await merch.locator('input[aria-label="Pieces"]').first().fill("3");
await merch.waitForTimeout(500);
for (const [j, o] of ["#CT10231", "#E2E1", "#E2E1"].entries()) await merch.locator(`[data-order="0-${j}"]`).fill(o);
await merch.waitForTimeout(1500);
await merch.click("button:has-text('Post consumption')"); await merch.waitForSelector("text=Is this a recut?", { timeout: 8000 }).catch(() => {});
check(await merch.locator("text=#CT10231_RECUT").count() + await merch.locator("text=#CT10231_recut").count() > 0, "repeated order # for the same fabric asks: recut?");
await merch.click("button:has-text('Yes, it')"); await merch.waitForSelector("text=POSTED");
const troc = await q1("select to_number from transfer_orders where style_po='CT26/PO/88' order by posted_at desc limit 1");
check((await q1("select count(*)::int n from order_links o join transfer_orders t on t.id=o.to_id where t.to_number=$1", [troc.to_number])).n === 3, `${troc.to_number}: 3 order links`);
check((await q1("select count(*)::int n from order_links o join transfer_orders t on t.id=o.to_id where t.to_number=$1 and upper(o.order_number) = '#CT10231_RECUT'", [troc.to_number])).n === 1, "recut saved as #CT10231_recut");
await admin.goto(B + "/invoices/INV-E2E-1"); await admin.waitForLoadState("networkidle");
check(await admin.locator("text=INV-E2E-1").count() > 0 && !/Application error/.test(await admin.locator("body").innerText()), "invoice page shows usage");

// reverse (own, within undo window) → next number
const t = await q1("select id from transfer_orders where to_number=$1", [troc.to_number]);
await merch.goto(B + "/log/" + t.id); await merch.click("button:has-text('Undo')"); await merch.waitForTimeout(1500);
const rev = await q1("select r.to_number from transfer_orders r join transfer_orders o on o.id=r.reversal_of_id where o.to_number=$1", [troc.to_number]);
check(!!rev && /^TROC-\d{3}$/.test(rev.to_number), `reversal took the next number ${rev?.to_number}`);
check((await q1("select bool_and(reversed) v from order_links o join transfer_orders t on t.id=o.to_id where t.to_number=$1", [troc.to_number])).v === true, "order links marked reversed");

// find, zoho prompt
await admin.goto(B + "/find?q=%23CT10341"); check(await admin.locator("text=Order #CT10341").count() > 0, "find an order number");
await admin.goto(B + "/find?q=990A"); check(await admin.locator("text=Stock by location").count() > 0, "find a fabric");
await admin.goto(B + "/zoho?q=" + tro); await admin.waitForTimeout(1200);
check((await admin.locator("textarea").inputValue()).includes(`Transfer Order#: ${tro}`), "Zoho prompt built");

// permissions
await viewer.goto(B + "/to/transfer"); await viewer.waitForURL(/denied=1/, { timeout: 8000 }).catch(() => {}); check(viewer.url().includes("denied=1"), "viewer can't open transfer");
await merch.goto(B + "/to/pick"); await merch.waitForURL(/denied=1/, { timeout: 8000 }).catch(() => {}); check(merch.url().includes("denied=1"), "merchandiser can't pick a TROR");
await merch.goto(B + "/to/transfer"); await merch.waitForLoadState("networkidle"); check(!merch.url().includes("denied=1"), "merchandiser can plan a TROR");

// navigation, finder, interactive tables
await admin.goto(B + "/rolls"); await admin.waitForTimeout(800);
const allRows = await admin.locator("tbody tr").count();
await admin.fill('input[aria-label="Search this table"]', "990A"); await admin.waitForTimeout(500);
const some = await admin.locator("tbody tr").count();
check(some > 0 && some < allRows, `table search narrows rows (${allRows} → ${some})`);
await admin.click("th:has-text('LEFT')"); await admin.waitForTimeout(300);
const lefts = await admin.locator("tbody tr td:nth-child(10)").allInnerTexts();
check(lefts.length > 1 && lefts.every((v, i) => i === 0 || Number(lefts[i - 1].replace(/,/g, "")) <= Number(v.replace(/,/g, ""))), "click a header sorts the table");
await admin.keyboard.press("Control+k"); await admin.waitForTimeout(300);
await admin.keyboard.type("TROR-001"); await admin.waitForTimeout(1500);
check(await admin.locator("[role=dialog] >> text=Exact match").count() > 0, "Ctrl K finds an exact TO");
await admin.keyboard.press("Enter"); await admin.waitForURL(/\/log\//, { timeout: 15000 }).catch(() => {});
check(/\/log\//.test(admin.url()), "Enter opens it");
await admin.keyboard.press("Control+k"); await admin.waitForTimeout(300); await admin.keyboard.type("kg<15 at:Exim"); await admin.waitForTimeout(1500);
check(await admin.locator("[role=dialog] >> text=at Exim").count() > 0, "finder understands kg< and at: filters");
await admin.keyboard.press("Escape");
await admin.goto(B + "/find?q=ct26po48"); check(await admin.locator("text=CT26/PO/48").count() > 0, "find ignores symbols (ct26po48 → CT26/PO/48)");
await admin.goto(B + "/"); await admin.click("button[aria-label^='Notifications']"); await admin.waitForTimeout(400);
check(await admin.locator("[role=dialog][aria-label='Needs attention'] >> text=adjustment").count() > 0, "bell lists what needs attention");
await admin.keyboard.press("Escape");
await admin.click("button[aria-label='Collapse menu']"); await admin.waitForTimeout(400);
check(await admin.locator("button[aria-label='Expand menu']").count() > 0, "menu collapses to icons");
await admin.click("button[aria-label='Expand menu']");

// integrity + demo removal
const h = await (await admin.request.get(B + "/api/cron/health", { headers: { authorization: "Bearer " + (process.env.CRON_SECRET || "dev-cron") } })).json();
const red = (await q1("select issues from health_reports where id=$1", [h.id])).issues.filter((i) => i.severity === "red");
check(red.length === 0, "health: every roll re-derives from the logs " + JSON.stringify(red.slice(0, 2)));
await admin.goto(B + "/admin/tools"); await admin.click("text=Remove demo data"); await admin.waitForTimeout(2500);
check((await q1("select count(*)::int n from fabric_items where fabric_no in ('990A','990B','991A','991B','992')")).n === 0, "demo removed");
await admin.click("text=Load demo data"); await admin.waitForTimeout(8000);
check((await q1("select count(*)::int n from transfer_orders")).n >= 11 && (await q1("select count(*)::int n from transfer_orders where status='PLANNED'")).n >= 1, "demo reloaded from the Tools page (with a planned TROR)");
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASSED");
await browser.close(); await db.end();
