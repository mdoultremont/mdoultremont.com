import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.route("**/images/media/brand/face/*.png*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()
    await route.fulfill({
      path: `public/media/brand/face/${name}`,
      contentType: "image/png",
    })
  })
})

test("prepares blink with idle and plays it on pointer entry before returning to idle", async ({
  page,
}) => {
  const blink = page.waitForResponse((response) =>
    response.url().includes("/face/blink.png")
  )
  await page.goto("/")
  await blink
  const home = page.getByRole("link", { name: /Matthieu.*home/ })
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)
  await page.waitForTimeout(100)
  await home.locator("span").first().hover()
  await expect(home.locator("img").last()).toHaveAttribute("src", /blink\.png/)
  await page.mouse.move(0, 0)
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)
})

test("cycles to wink after blink and preloads the following hover expression", async ({
  page,
}) => {
  await page.goto("/")
  const home = page.getByRole("link", { name: /Matthieu.*home/ })
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)
  await home.locator("span").first().hover()
  await expect(home.locator("img").last()).toHaveAttribute("src", /blink\.png/)
  await page.mouse.move(0, 0)
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)
  await home.locator("span").first().hover()
  await expect(home.locator("img").last()).toHaveAttribute("src", /wink\.png/)
})

test("plays the first hover after an early pointer entry once it is decoded", async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/images/media/brand/face/blink.png*", async (route) => {
    await held
    await route.fulfill({
      path: "public/media/brand/face/blink.png",
      contentType: "image/png",
    })
  })
  await page.goto("/")
  const home = page.getByRole("link", { name: /Matthieu.*home/ })
  await page.waitForTimeout(100)
  await home.locator("span").first().hover()
  release()
  await expect(home.locator("img").last()).toHaveAttribute("src", /blink\.png/)
})

test("keeps the static face until deferred idle finishes decoding", async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/images/media/brand/face/idle.png*", async (route) => {
    await held
    await route.fulfill({
      path: "public/media/brand/face/idle.png",
      contentType: "image/png",
    })
  })
  await page.goto("/")
  const home = page.getByRole("link", { name: /Matthieu.*home/ })
  await expect(home.locator("img").first()).toBeVisible()
  expect(await home.locator("img").count()).toBe(1)
  release()
  await expect(home.locator("img")).toHaveCount(2)
  await expect
    .poll(() =>
      home.evaluate((el) => el.getAnimations({ subtree: true }).length)
    )
    .toBe(1)
})

test("reduced motion renders a responsive static home icon without animation requests", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const spriteRequests: string[] = []
  page.on("request", (request) => {
    if (/\/(idle|blink|wink|sprite)[^/]*\.(png|webp)/.test(request.url())) {
      spriteRequests.push(request.url())
    }
  })
  await page.goto("/")
  const home = page.getByRole("link", { name: /Matthieu.*home/ })
  await expect(home).toHaveAttribute("href", "/")
  const face = home.locator("img").first()
  await expect(face).toBeVisible()
  await expect(face).toHaveAttribute(
    "srcset",
    /width=40[^ ]* 1x,.*width=80[^ ]* 2x,.*width=120[^ ]* 3x/
  )
  expect(spriteRequests).toEqual([])
})

test("ignores a stale idle decode when motion is reduced, then resumes one hover sequence", async ({
  page,
}) => {
  let releaseFirstIdle!: () => void
  let idleRequests = 0
  const firstIdle = new Promise<void>((resolve) => {
    releaseFirstIdle = resolve
  })
  await page.route("**/images/media/brand/face/idle.png*", async (route) => {
    idleRequests += 1
    if (idleRequests === 1) await firstIdle
    await route.fulfill({
      path: "public/media/brand/face/idle.png",
      contentType: "image/png",
    })
  })

  await page.goto("/")
  const home = page.getByRole("link", { name: /Matthieu.*home/ })
  await expect(home.locator("img").first()).toBeVisible()
  await expect(home.locator("img")).toHaveCount(1)
  await expect.poll(() => idleRequests).toBe(1)

  await page.emulateMedia({ reducedMotion: "reduce" })
  const completedIdle = page.waitForResponse((response) =>
    response.url().includes("/face/idle.png")
  )
  releaseFirstIdle()
  await (await completedIdle).finished()
  // Give the off-DOM image decoder time to deliver the stale completion.
  await page.waitForTimeout(100)
  await expect(home.locator("img")).toHaveCount(1)
  await expect
    .poll(() =>
      home.evaluate((el) => el.getAnimations({ subtree: true }).length)
    )
    .toBe(0)

  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(home.locator("img")).toHaveCount(2)
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)

  await page.mouse.move(0, 0)
  await home.locator("span").first().hover()
  await expect(home.locator("img").last()).toHaveAttribute("src", /blink\.png/)
  await page.mouse.move(0, 0)
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)
  await home.locator("span").first().hover()
  await expect(home.locator("img").last()).toHaveAttribute("src", /wink\.png/)
})

test("keeps the ready face after a failed sprite request and retries on the next entry", async ({
  page,
}) => {
  let winkRequests = 0
  const failedWink = page.waitForResponse(
    (response) =>
      response.url().includes("/face/wink.png") && response.status() === 404
  )
  await page.route("**/images/media/brand/face/wink.png*", async (route) => {
    winkRequests += 1
    if (winkRequests === 1) {
      await route.fulfill({ status: 404, contentType: "image/png", body: "" })
      return
    }
    await route.fulfill({
      path: "public/media/brand/face/wink.png",
      contentType: "image/png",
    })
  })

  await page.goto("/")
  const home = page.getByRole("link", { name: /Matthieu.*home/ })
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)

  await home.locator("span").first().hover()
  await expect(home.locator("img").last()).toHaveAttribute("src", /blink\.png/)
  await failedWink
  await page.mouse.move(0, 0)
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)

  const retriedWink = page.waitForResponse(
    (response) =>
      response.url().includes("/face/wink.png") && response.status() === 200
  )
  await home.locator("span").first().hover()
  await retriedWink
  await expect(home.locator("img").last()).toHaveAttribute("src", /blink\.png/)
  await page.mouse.move(0, 0)
  await expect(home.locator("img").last()).toHaveAttribute("src", /idle\.png/)
  await home.locator("span").first().hover()
  await expect(home.locator("img").last()).toHaveAttribute("src", /wink\.png/)
})
