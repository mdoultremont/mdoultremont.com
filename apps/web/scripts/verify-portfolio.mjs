import { chromium } from "@playwright/test"
import assert from "node:assert/strict"
const browser = await chromium.launch()
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
})
const page = await context.newPage()
const base = process.argv[2] || "http://localhost:4183"
const results = []
const errors = []
page.on("pageerror", (e) => errors.push(e.message))
for (const width of [320, 390, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 900 })
  for (const route of ["/", "/photography"]) {
    const response = await page.goto(base + route)
    assert.equal(response.status(), 200)
    await page.locator("main").waitFor()
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1: document.querySelectorAll("h1").length,
      brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(
        (a) => !document.querySelector(a.getAttribute("href"))
      ).length,
    }))
    assert.equal(layout.scrollWidth, width)
    assert.equal(layout.h1, 1)
    assert.equal(layout.brokenAnchors, 0)
    results.push({ route, ...layout })
  }
}
await page.goto(base)
await page.keyboard.press("Tab")
assert.equal(await page.locator(":focus").innerText(), "Skip to content")
await page.keyboard.press("Enter")
await page.getByRole("button", { name: "Get in touch", exact: true }).click()
await page.getByText("Email copied", { exact: true }).waitFor()
assert.equal(
  await page.evaluate(() => navigator.clipboard.readText()),
  "hello@mdoultremont.com"
)
await page.getByRole("link", { name: "Photography", exact: true }).click()
await page.getByRole("button", { name: /^View photograph 1(?:$|:)/ }).click()
await page.getByRole("dialog").waitFor()
await page.keyboard.press("ArrowRight")
await page.getByLabel("Photograph 2 of", { exact: false }).waitFor()
await page.keyboard.press("Escape")
await page.getByRole("dialog").waitFor({ state: "hidden" })
await page.setViewportSize({ width: 320, height: 700 })
await page.getByRole("button", { name: /^View photograph 1(?:$|:)/ }).click()
await page
  .getByRole("button", { name: "Next photograph", exact: true })
  .filter({ visible: true })
  .click()
await page.getByLabel("Photograph 2 of", { exact: false }).waitFor()
await page
  .getByRole("button", { name: "Close photograph", exact: true })
  .filter({ visible: true })
  .click()
await page.emulateMedia({ reducedMotion: "reduce" })
assert.equal(
  await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches
  ),
  true
)
assert.equal(
  await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior
  ),
  "auto"
)
assert.deepEqual(errors, [])
console.log(
  JSON.stringify(
    {
      browser: browser.version(),
      results,
      errors,
      checks: [
        "skip link",
        "copy email with clipboard assertion",
        "navigation",
        "gallery keyboard next and escape",
        "320px gallery next and close",
        "reduced motion scroll behavior",
      ],
    },
    null,
    2
  )
)
await browser.close()
