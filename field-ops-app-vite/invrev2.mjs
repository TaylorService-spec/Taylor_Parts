import { chromium } from "@playwright/test";
import fs from "fs";
const BASE = "https://eos-platform-sandbox.web.app";
const SHOTS = "C:/Users/Rudy2/AppData/Local/Temp/claude/d--Taylor-Parts/4a4e40dd-c7a5-479f-98b9-f04d905a4141/scratchpad/shots";
const creds = JSON.parse(fs.readFileSync("C:/Users/Rudy2/Favorites/Downloads/sandbox-credentials.local.json", "utf8"));
const log = [];
const L = (...a) => { console.log(...a); log.push(a.join(" ")); };

function dumpRail() {
  const el = document.querySelector("aside.fo-rail") || document.querySelector("nav");
  if (!el) return { err: "no rail" };
  const r = el.getBoundingClientRect();
  const nav = el.querySelector(".fo-rail__nav") || el;
  const items = [...el.querySelectorAll("button,a")].map(n => {
    const b = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { t: n.tagName, txt: (n.innerText || "").replace(/\n/g, " ").trim(), cls: n.className.toString().slice(0, 70),
      y: Math.round(b.y), bot: Math.round(b.bottom), h: Math.round(b.height), x: Math.round(b.x), w: Math.round(b.width),
      fs: cs.fontSize, fw: cs.fontWeight, pl: cs.paddingLeft, color: cs.color, bg: cs.backgroundColor,
      exp: n.getAttribute("aria-expanded"), cur: n.getAttribute("aria-current"), href: n.getAttribute("href"),
      clip: n.scrollWidth > n.clientWidth + 1 };
  });
  return { railW: Math.round(r.width), railH: Math.round(r.height), navScrollH: nav.scrollHeight, navClientH: nav.clientHeight, vh: window.innerHeight, items };
}
const P = (r, lbl) => { L("--- " + lbl + " railW=" + r.railW + " railH=" + r.railH + " navScrollH=" + r.navScrollH + " navClientH=" + r.navClientH + " vh=" + r.vh);
  (r.items || []).forEach(i => L("   [" + i.t + "] " + i.cls + " y=" + i.y + "-" + i.bot + " h=" + i.h + " x=" + i.x + " w=" + i.w + " fs=" + i.fs + " fw=" + i.fw + " pl=" + i.pl + " col=" + i.color + " bg=" + i.bg + " exp=" + i.exp + " cur=" + i.cur + " clip=" + i.clip + " href=" + i.href + " :: " + JSON.stringify(i.txt))); };

async function run(email, tag) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', creds[email]);
  await p.click('button[type="submit"]');
  await p.waitForSelector(".fo-shell", { timeout: 40000 });
  await p.waitForTimeout(2500);
  L(""); L("========== " + tag + " ==========");
  L("URL: " + p.url());

  // Expand EVERY domain row one at a time and record children
  const rows = await p.locator("aside.fo-rail button.fo-rail__domain-row").all();
  L("domain row count = " + rows.length);
  for (let i = 0; i < rows.length; i++) {
    const label = (await rows[i].innerText()).replace(/\n/g, " ").trim();
    const u0 = p.url();
    await rows[i].click();
    await p.waitForTimeout(700);
    const u1 = p.url();
    const kids = await p.evaluate(() => [...document.querySelectorAll("aside.fo-rail a")].map(a => a.innerText.replace(/\n/g, " ").trim() + " => " + a.getAttribute("href") + " [" + a.className.toString().slice(0, 55) + "]"));
    L("EXPAND " + JSON.stringify(label) + " urlBefore=" + u0 + " urlAfter=" + u1 + " NAVIGATED=" + (u0 !== u1));
    L("   links now: " + JSON.stringify(kids));
    await p.screenshot({ path: SHOTS + "/" + tag + "-exp-" + label.replace(/\W+/g, "") + ".png" });
    P(await p.evaluate(dumpRail), tag + " expanded:" + label);
    // collapse again
    await rows[i].click(); await p.waitForTimeout(400);
  }

  // Expand ALL simultaneously
  for (const r of rows) { await r.click(); await p.waitForTimeout(350); }
  await p.screenshot({ path: SHOTS + "/" + tag + "-allexpanded.png" });
  P(await p.evaluate(dumpRail), tag + " ALL-EXPANDED 1440x950");

  // click each link, verify route + selected state
  const hrefs = await p.evaluate(() => [...document.querySelectorAll("aside.fo-rail a")].map(a => a.getAttribute("href")));
  for (const h of hrefs) {
    const el = p.locator('aside.fo-rail a[href="' + h + '"]').first();
    await el.click(); await p.waitForTimeout(1200);
    const st = await p.evaluate(() => {
      const cur = [...document.querySelectorAll("aside.fo-rail a,aside.fo-rail button")].filter(n => n.getAttribute("aria-current") || /--current|--active/.test(n.className.toString())).map(n => n.innerText.replace(/\n/g, " ").trim() + " {" + n.className.toString().slice(0, 60) + "}");
      const m = document.querySelector("main") || document.body;
      const hd = document.querySelector("main h1, main h2, h1");
      return { cur, hd: hd ? hd.innerText.trim() : null, txt: (m.innerText || "").replace(/\n+/g, " | ").slice(0, 320) };
    });
    L("NAV " + h + " -> url=" + p.url() + " head=" + JSON.stringify(st.hd) + " selected=" + JSON.stringify(st.cur));
    L("    body: " + st.txt);
    await p.screenshot({ path: SHOTS + "/" + tag + "-page-" + h.replace(/\W+/g, "_") + ".png" });
  }

  // direct URL probes for inventory destinations
  for (const path of ["/inventory", "/inventory/parts", "/inventory/part-master", "/inventory/warehouses", "/inventory/truck-inventory", "/inventory/receiving", "/inventory/transfers", "/inventory/cycle-counts", "/inventory/back-orders", "/purchasing", "/purchasing/purchase-orders"]) {
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    const st = await p.evaluate(() => { const m = document.querySelector("main") || document.body; const hd = document.querySelector("main h1,main h2,h1"); return { hd: hd ? hd.innerText.trim() : null, txt: (m.innerText || "").replace(/\n+/g, " | ").slice(0, 200) }; });
    L("PROBE " + path + " -> " + p.url() + " head=" + JSON.stringify(st.hd) + " :: " + st.txt);
  }
  await p.screenshot({ path: SHOTS + "/" + tag + "-probe-last.png" });

  // 1024 with all expanded
  await p.goto(BASE + "/dashboard", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.setViewportSize({ width: 1024, height: 900 }); await p.waitForTimeout(600);
  for (const r of await p.locator("aside.fo-rail button.fo-rail__domain-row").all()) { await r.click(); await p.waitForTimeout(300); }
  await p.screenshot({ path: SHOTS + "/" + tag + "-1024-allexp.png" });
  P(await p.evaluate(dumpRail), tag + " 1024 ALL-EXPANDED");

  // 390 drawer
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
  await p.screenshot({ path: SHOTS + "/" + tag + "-390-closed2.png" });
  await p.click(".fo-navtoggle"); await p.waitForTimeout(900);
  await p.screenshot({ path: SHOTS + "/" + tag + "-390-drawer.png" });
  P(await p.evaluate(dumpRail), tag + " 390 DRAWER");
  for (const r of await p.locator("aside.fo-rail button.fo-rail__domain-row").all()) { await r.click().catch(() => {}); await p.waitForTimeout(300); }
  await p.screenshot({ path: SHOTS + "/" + tag + "-390-drawer-allexp.png" });
  P(await p.evaluate(dumpRail), tag + " 390 DRAWER ALL-EXPANDED");
  L("console errors: " + JSON.stringify(errs.slice(0, 10)));
  await b.close();
}
for (const [e, t] of [["whmgr@sandbox.invalid", "whmgr"], ["partsmgr@sandbox.invalid", "partsmgr"]]) {
  try { await run(e, t); } catch (err) { L("ERROR " + t + ": " + err.message.slice(0, 300)); }
}
fs.writeFileSync(SHOTS + "/../invrev2-log.txt", log.join("\n"));
