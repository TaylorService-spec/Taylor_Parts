// LOCAL PROOF DRIVER (temporary, removed after the proof): open a page as a harness subject and screenshot it.
import { chromium } from "playwright";
const [subject, path, out, width = "1440", ...steps] = process.argv.slice(2);
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const token = `${b({ alg: "EdDSA", typ: "JWT", kid: "local-harness" })}.${b({ sub: subject, iat: now, exp: now + 3600 })}.bG9jYWw`;
const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 } });
await ctx.addInitScript((t) => { try { sessionStorage.setItem("eos.session.v1", t); } catch {} }, token);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(`http://localhost:5391/Taylor_Parts/field-ops${path}`);
await page.waitForTimeout(3500);
for (const step of steps) {
  const [kind, ...rest] = step.split("=");
  const arg = rest.join("=");
  if (kind === "click") await page.getByRole("button", { name: arg }).first().click();
  else if (kind === "clicktext") await page.getByText(arg, { exact: false }).first().click();
  else if (kind === "link") await page.getByRole("link", { name: arg }).first().click();
  else if (kind === "wait") await page.waitForTimeout(Number(arg));
  else if (kind === "select") { const [label, value] = arg.split("|"); await page.getByLabel(label).selectOption(value); }
  else if (kind === "fill") { const [label, value] = arg.split("|"); await page.getByLabel(label).first().fill(value); }
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: out, fullPage: true });
const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
console.log(JSON.stringify({ url: page.url(), errors, overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth) }));
console.log(text.slice(0, Number(process.env.TEXT ?? 1500)));
await ctx.close();
await browser.close();
