import { chromium } from "@playwright/test";
import fs from "fs";
const BASE = "https://eos-platform-sandbox.web.app";
const SHOTS = "C:/Users/Rudy2/AppData/Local/Temp/claude/d--Taylor-Parts/4a4e40dd-c7a5-479f-98b9-f04d905a4141/scratchpad/shots";
fs.mkdirSync(SHOTS, { recursive: true });
const creds = JSON.parse(fs.readFileSync("C:/Users/Rudy2/Favorites/Downloads/sandbox-credentials.local.json", "utf8"));
const log = [];
const L = (...a) => { console.log(...a); log.push(a.join(" ")); };

function dumpRail() {
  const el = document.querySelector("nav") || document.querySelector("aside");
  if (!el) return { err: "no rail el" };
  const r = el.getBoundingClientRect();
  const items = [...el.querySelectorAll("button,a")].map(n => {
    const b = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      t: n.tagName, txt: (n.innerText || "").replace(/\n/g, " ").trim(),
      cls: (n.className || "").toString().slice(0, 80),
      x: Math.round(b.x), y: Math.round(b.y), bot: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height),
      fs: cs.fontSize, fw: cs.fontWeight, pl: cs.paddingLeft, tt: cs.textTransform, ls: cs.letterSpacing,
      color: cs.color, bg: cs.backgroundColor,
      exp: n.getAttribute("aria-expanded"), cur: n.getAttribute("aria-current"), href: n.getAttribute("href"),
      clip: n.scrollWidth > n.clientWidth + 1, sw: n.scrollWidth, cw: n.clientWidth
    };
  });
  return { cls: el.className.toString(), w: Math.round(r.width), x: Math.round(r.x), h: Math.round(r.height), scrollH: el.scrollHeight, clientH: el.clientHeight, vh: window.innerHeight, items };
}

function printRail(rail, label) {
  L("--- " + label + " rail cls=" + rail.cls + " w=" + rail.w + " x=" + rail.x + " scrollH=" + rail.scrollH + " clientH=" + rail.clientH + " vh=" + rail.vh);
  (rail.items || []).forEach(i => L("   [" + i.t + "] y=" + i.y + "-" + i.bot + " h=" + i.h + " x=" + i.x + " w=" + i.w + " fs=" + i.fs + " fw=" + i.fw + " pl=" + i.pl + " tt=" + i.tt + " ls=" + i.ls + " color=" + i.color + " bg=" + i.bg + " exp=" + i.exp + " cur=" + i.cur + " clip=" + i.clip + "(" + i.sw + "/" + i.cw + ") href=" + i.href + " :: " + JSON.stringify(i.txt)));
}

async function run(email, tag) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', creds[email]);
  await p.click('button[type="submit"]');
  await p.waitForSelector(".fo-shell", { timeout: 40000 });
  await p.waitForTimeout(1800);
  L("");
  L("========== " + tag + " (" + email + ") ==========");
  L("URL after login: " + p.url());

  printRail(await p.evaluate(dumpRail), tag + " INITIAL 1440");
  await p.screenshot({ path: SHOTS + "/" + tag + "-1440-initial.png" });

  const urlBefore = p.url();
  const invBtn = p.locator("nav button, aside button").filter({ hasText: /^Inventory$/ }).first();
  if (await invBtn.count()) {
    await invBtn.click();
    await p.waitForTimeout(900);
    L("URL after expanding Inventory: " + p.url() + " | unchanged=" + (p.url() === urlBefore));
  } else {
    L("!! no exact-match Inventory domain button found");
  }
  await p.screenshot({ path: SHOTS + "/" + tag + "-1440-inv-expanded.png" });
  await p.screenshot({ path: SHOTS + "/" + tag + "-1440-inv-expanded-full.png", fullPage: true });
  printRail(await p.evaluate(dumpRail), tag + " INVENTORY-EXPANDED 1440");

  const destNames = ["Parts", "Part Master", "Manufacturers", "Warehouses", "Truck Inventory", "Transfers", "Receiving", "Cycle Counts", "Back Orders"];
  for (const d of destNames) {
    const el = p.locator("nav a, aside a").filter({ hasText: new RegExp("^" + d + "$") }).first();
    if (await el.count() === 0) { L('DEST "' + d + '": NOT PRESENT'); continue; }
    await el.click();
    await p.waitForTimeout(1200);
    const st = await p.evaluate(() => {
      const el = document.querySelector("nav") || document.querySelector("aside");
      const cur = [...el.querySelectorAll("a,button")].filter(n => n.getAttribute("aria-current") || /active|selected|current/i.test(n.className.toString()));
      const main = document.querySelector("main") || document.body;
      const h = document.querySelector("main h1, main h2, h1");
      return {
        cur: cur.map(n => n.innerText.replace(/\n/g, " ").trim() + " [" + n.className.toString().slice(0, 55) + "]"),
        head: h ? h.innerText.trim() : null,
        snippet: (main.innerText || "").replace(/\n+/g, " | ").slice(0, 300)
      };
    });
    L('DEST "' + d + '" -> url=' + p.url() + " selected=" + JSON.stringify(st.cur) + " head=" + JSON.stringify(st.head));
    L("     body: " + st.snippet);
  }
  await p.screenshot({ path: SHOTS + "/" + tag + "-1440-dest.png" });

  const purBtn = p.locator("nav button, aside button").filter({ hasText: /^Purchasing$/ }).first();
  if (await purBtn.count()) {
    const u2 = p.url();
    await purBtn.click();
    await p.waitForTimeout(800);
    L("URL after expanding Purchasing: " + p.url() + " | unchanged=" + (p.url() === u2));
    const pi = await p.evaluate(() => [...(document.querySelector("nav") || document.querySelector("aside")).querySelectorAll("a")].map(a => a.innerText.replace(/\n/g, " ").trim() + " => " + a.getAttribute("href")));
    L("All rail links w/ Inventory+Purchasing open: " + JSON.stringify(pi, null, 0));
    await p.screenshot({ path: SHOTS + "/" + tag + "-1440-inv-purch.png" });
    await p.screenshot({ path: SHOTS + "/" + tag + "-1440-inv-purch-full.png", fullPage: true });
    printRail(await p.evaluate(dumpRail), tag + " INV+PURCH 1440");
  } else L("no Purchasing domain button");

  await p.setViewportSize({ width: 1024, height: 900 });
  await p.waitForTimeout(800);
  printRail(await p.evaluate(dumpRail), tag + " 1024");
  await p.screenshot({ path: SHOTS + "/" + tag + "-1024.png" });
  await p.screenshot({ path: SHOTS + "/" + tag + "-1024-full.png", fullPage: true });

  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(900);
  await p.screenshot({ path: SHOTS + "/" + tag + "-390-closed.png" });
  const btns = await p.evaluate(() => [...document.querySelectorAll("button")].slice(0, 25).map(n => ({ txt: (n.innerText || "").replace(/\n/g, " ").trim().slice(0, 40), al: n.getAttribute("aria-label"), cls: n.className.toString().slice(0, 60) })));
  L("390 buttons: " + JSON.stringify(btns));
  const mb = p.locator('[aria-label*="menu" i], [aria-label*="nav" i], button:has-text("Menu")').first();
  let opened = false;
  if (await mb.count()) { await mb.click(); await p.waitForTimeout(900); opened = true; }
  L("390 drawer opened=" + opened);
  await p.screenshot({ path: SHOTS + "/" + tag + "-390-drawer.png" });
  printRail(await p.evaluate(dumpRail), tag + " 390-DRAWER");
  await p.screenshot({ path: SHOTS + "/" + tag + "-390-drawer-full.png", fullPage: true });

  await b.close();
}

try { await run("whmgr@sandbox.invalid", "whmgr"); } catch (e) { L("ERROR whmgr: " + e.message); }
try { await run("partsmgr@sandbox.invalid", "partsmgr"); } catch (e) { L("ERROR partsmgr: " + e.message); }
fs.writeFileSync(SHOTS + "/../invrev-log.txt", log.join("\n"));
