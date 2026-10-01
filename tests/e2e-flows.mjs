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
  "/adjustments/list", "/check", "/rolls", "/log", "/orders", "/audit", "/formats", "/admin/fabrics", "/admin/locations", "/admin/racks", "/admin/users", "/admin/settings", "/admin/tools"]) {
  const r = await admin.goto(B + path); await admin.waitForLoadState("networkidle"); const t = await admin.locator("body").innerText();
  check(r.status() < 400 && !/Application error|Internal Server Error/.test(t), `page ${path}`);
}

// receive a PO with two fabrics
await inv.goto(B + "/receive");
await inv.fill('input[placeholder="CT26/PO/48 or PO-112"]', "CT26/PO/200");
await sel(inv, "Received at").selectOption({ label: "Rajdanga Storage" });
const items = inv.locator('input[list="fablist"]');
await items.nth(0).fill("990A");
for (const [j, w] of ["20.5", "21.25"].entries()) { const x = inv.locator(`[data-w="0-${j}"]`); await x.fill(w); await x.press("Enter"); }
await inv.click("text=+ Add another fabric"); await inv.locator('input[list="fablist"]').nth(1).fill("DM-SKU-3D2-CHA");
await inv.locator('[data-w="1-0"]').fill("30");
await inv.click("text=Receive and create rolls"); await inv.waitForSelector("text=PO RECEIVED");
const rec = (await db.query("select r.serial, b.code from rolls r join batches b on b.id=r.batch_id where r.fabric_po='CT26/PO/200' order by r.weighed_g")).rows;
check(rec.length === 3 && rec.some((r) => r.code === "B-CT26PO200-990A-01") && rec.some((r) => r.code === "B-CT26PO200-991A-01"), "PO received: 3 rolls, 2 batches " + rec.map((r) => r.code));
await inv.goto(B + "/receive"); await inv.fill('input[placeholder="CT26/PO/48 or PO-112"]', "BAD"); await sel(inv, "Received at").selectOption({ label: "Rajdanga Storage" });
await inv.locator('input[list="fablist"]').nth(0).fill("990A"); await inv.locator('[data-w="0-0"]').fill("95");
await inv.click("text=Receive and create rolls"); await inv.waitForTimeout(700);
check(await inv.locator("text=a weight is not 0–80 kg").count() > 0, "weight above 80 kg refused");
await inv.click("text=Clear");

// put away activates the new labels
await inv.goto(B + "/warehouse/put"); await scan(inv, "RK-R4-A"); for (const r of rec) await scan(inv, r.serial);
check((await q1("select count(*)::int n from rolls where fabric_po='CT26/PO/200' and status='IN_STOCK' and rack_id is not null")).n === 3, "put away placed + activated the 3 new rolls");

// transfer with a cut: 990A, kg that ends inside a roll
const before = await q1("select coalesce(max(substring(to_number from 6)::int),0) m from transfer_orders");
await inv.goto(B + "/to/transfer");
await sel(inv, "Source location").selectOption({ label: "Rajdanga Storage" });
await sel(inv, "Destination location").selectOption({ label: "Exim" });
await inv.locator('input[list="fablist"]').first().fill("990A");
await inv.locator('input[aria-label="Quantity kg"]').first().fill("30");
await inv.waitForTimeout(1500);
check(await inv.locator("text=PICK LIST").count() > 0 && await inv.locator("text=/cut, .* kg stays/").count() > 0, "live pick list shows the cut");
await inv.click("button:has-text('Post transfer')"); await inv.waitForSelector("text=POSTED");
const tro = `TROR-${String(before.m + 1).padStart(3, "0")}`;
check(await inv.locator(`text=${tro}`).count() > 0, `transfer posted with the next shared number ${tro}`);
const cut = await q1("select r.serial, l.name from rolls r join locations l on l.id=r.current_location_id where r.notes = $1", [`Cut piece on ${tro}`]);
check(cut && cut.name === "Exim", "cut piece made and moved to Exim " + (cut?.serial ?? ""));

// transfer to production refused; consumption with pieces per row
await inv.goto(B + "/to/transfer");
check(!(await sel(inv, "Destination location").innerText()).includes("Rajdanga Production"), "transfer can't go to a production location");
await merch.goto(B + "/to/consumption");
await sel(merch, "Source location").selectOption({ label: "Rajdanga Storage" });
await merch.fill('input[placeholder="CT26/PO/88 or PO-112"]', "CT26/PO/88");
await merch.locator('input[list="fablist"]').first().fill("990B");
await merch.locator('input[aria-label="Kg used"]').first().fill("2");
await merch.locator('input[aria-label="Pieces"]').first().fill("3");
await merch.waitForTimeout(500);
for (let j = 0; j < 3; j++) await merch.locator(`[data-order="0-${j}"]`).fill(`#E2E${j < 2 ? "1" : "2"}`);
await merch.click("button:has-text('Post consumption')"); await merch.waitForSelector("text=POSTED");
const troc = await q1("select to_number from transfer_orders where style_po='CT26/PO/88' order by posted_at desc limit 1");
check((await q1("select count(*)::int n from order_links o join transfer_orders t on t.id=o.to_id where t.to_number=$1", [troc.to_number])).n === 3, `${troc.to_number}: 3 order links`);
await merch.goto(B + "/to/consumption");
await sel(merch, "Source location").selectOption({ label: "Rajdanga Storage" });
await merch.fill('input[placeholder="CT26/PO/88 or PO-112"]', "XX/12");
await merch.locator('input[list="fablist"]').first().fill("990B"); await merch.locator('input[aria-label="Kg used"]').first().fill("1");
await merch.click("button:has-text('Post consumption')"); await merch.waitForTimeout(1200);
check(await merch.locator("text=Style PO must look like").count() > 0, "bad style PO refused");
await merch.click("text=Clear");

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
await merch.goto(B + "/to/transfer"); await merch.waitForURL(/denied=1/, { timeout: 8000 }).catch(() => {}); check(merch.url().includes("denied=1"), "merchandiser can't open transfer");

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
check((await q1("select count(*)::int n from transfer_orders")).n >= 11, "demo reloaded from the Tools page");
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASSED");
await browser.close(); await db.end();
