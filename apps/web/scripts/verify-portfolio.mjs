import { chromium, expect } from "@playwright/test"
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
for (const route of ["/", "/photography", "/personal", "/iterations"]) {
  await page.goto(base + route)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.keyboard.press("Tab")
  assert.equal(await page.locator(":focus").innerText(), "Skip to content")
  await page.keyboard.press("Enter")
  assert.equal(new URL(page.url()).hash, "#main-content")
  await page.keyboard.press("Tab")
  assert.equal(
    await page.locator(":focus").evaluate((el) => Boolean(el.closest("main"))),
    true
  )
  const clearance = await page.evaluate(() => ({
    main: document.querySelector("main").getBoundingClientRect().top,
    header: document.querySelector("header").getBoundingClientRect().bottom,
  }))
  assert.ok(clearance.main >= clearance.header - 1)
}
await page.goto(base)
await page.emulateMedia({ reducedMotion: "no-preference" })
const focusChecks = []
for (const route of ["/", "/photography"]) {
  await page.goto(base + route)
  await page.keyboard.press("Tab")
  const actions = page.locator(
    "header button, main > section:first-child button, main > section:first-child a, footer button, footer a"
  )
  for (const action of await actions.all()) {
    if (!(await action.isVisible())) continue
    await action.focus()
    await page.keyboard.press("Shift")
    await expect(action).toHaveCSS("outline-color", "rgb(18, 18, 18)")
    const style = await action.evaluate((el) => {
      const css = getComputedStyle(el)
      return {
        text: el.textContent.trim(),
        color: css.outlineColor,
        width: css.outlineWidth,
      }
    })
    assert.equal(style.color, "rgb(18, 18, 18)", JSON.stringify(style))
    assert.equal(style.width, "2px")
    focusChecks.push({ route, ...style })
  }
}
await page.goto(base)
await page.getByRole("button", { name: "Get in touch", exact: true }).click()
await page.getByText("Email copied", { exact: true }).waitFor()
assert.equal(
  await page.evaluate(() => navigator.clipboard.readText()),
  "hello@mdoultremont.com"
)
await page.keyboard.press("Tab")
await page
  .getByRole("button", { name: "Close", exact: true, includeHidden: true })
  .focus()
await page.keyboard.press("Shift")
assert.equal(
  await page
    .getByRole("button", { name: "Close", exact: true, includeHidden: true })
    .evaluate((el) => getComputedStyle(el).outlineColor),
  "rgb(248, 247, 244)"
)
await page
  .getByRole("button", { name: "Close", exact: true, includeHidden: true })
  .click()
await page.getByRole("link", { name: "Photography", exact: true }).click()
assert.equal(new URL(page.url()).pathname.replace(/\/$/, ""), "/photography")
await page.getByRole("button", { name: /^View photograph 1(?:$|:)/ }).click()
await page.getByRole("dialog").waitFor()
await expect(page.getByRole("dialog").locator("img")).toBeVisible()
await page.waitForFunction(() => {
  const image = document.querySelector('[role="dialog"] img')
  return image?.complete && image.naturalWidth > 0
})
const close = page
  .getByRole("button", { name: "Close photograph", exact: true })
  .filter({ visible: true })
await page.keyboard.press("Tab")
await close.focus()
await page.keyboard.press("Shift")
await expect(close).toHaveCSS("outline-color", "rgb(248, 247, 244)")
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
      generatedAt: new Date().toISOString(),
      stylesheets: await page
        .locator('link[rel="stylesheet"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
      browser: browser.version(),
      focusChecks,
      results,
      errors,
      checks: [
        "skip destination, header clearance and keyboard continuation on all shell routes",
        "ink focus rings on light surfaces and paper rings on toast and gallery",
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
