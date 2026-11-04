import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"
const directory = process.argv[2]
if (!directory)
  throw new Error("Provide an output directory outside the repository")
await mkdir(directory, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const [route, name, anchor] of [
  ["/", "home", null],
  ["/photography", "photography", null],
  ["/", "experience", "#experience"],
  ["/photography", "collection", "#collection"],
]) {
  for (const [width, height, label] of [
    [1440, 900, "desktop"],
    [390, 844, "mobile"],
  ]) {
    await page.setViewportSize({ width, height })
    await page.goto("http://localhost:4183" + route, {
      waitUntil: "networkidle",
    })
    await page.evaluate(() => document.fonts.ready)
    if (anchor)
      await page
        .locator(anchor)
        .evaluate((e) => e.scrollIntoView({ behavior: "instant" }))
    await page.screenshot({ path: `${directory}/after-${name}-${label}.png` })
  }
}
await browser.close()
