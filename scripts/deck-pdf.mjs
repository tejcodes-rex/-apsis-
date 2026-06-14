import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = pathToFileURL(resolve("deck/index.html")).href;
async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel }); } catch { /* next */ }
  }
  return chromium.launch();
}
const browser = await launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "load" });
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: "deck/APSIS-deck.pdf",
  preferCSSPageSize: true,
  printBackground: true,
  landscape: true,
});
await browser.close();
console.log("wrote deck/APSIS-deck.pdf");
