import { chromium, expect } from "@playwright/test"
import { mkdir } from "node:fs/promises"
const directory = process.argv[2]
const base = process.argv[3] || "http://localhost:4183"
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
    [768, 1024, "tablet"],
  ]) {
    await page.setViewportSize({ width, height })
    await page.goto(base + route, {
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
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(base + "/photography", { waitUntil: "networkidle" })
await page.keyboard.press("Tab")
await page
  .getByRole("link", { name: "See the collection", exact: true })
  .focus()
await expect(
  page.getByRole("link", { name: "See the collection", exact: true })
).toHaveCSS("outline-color", "rgb(18, 18, 18)")
await page.screenshot({ path: `${directory}/after-focus-collection.png` })
await page.getByRole("button", { name: /^View photograph 1(?:$|:)/ }).click()
await page.getByRole("dialog").waitFor()
await expect(page.getByRole("dialog").locator("img")).toBeVisible()
await page.waitForFunction(() => {
  const image = document.querySelector('[role="dialog"] img')
  return image?.complete && image.naturalWidth > 0
})
await page.keyboard.press("Tab")
await page
  .getByRole("button", { name: "Close photograph", exact: true })
  .filter({ visible: true })
  .focus()
await page.screenshot({ path: `${directory}/after-focus-gallery.png` })
await browser.close()
