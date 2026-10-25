import { expect, test, type Page } from "@playwright/test"
import type { PlayerFixtureOptions } from "./support/mount-player"

import { fakeSpotify } from "./support/fake-spotify"

const fixtureReady = {
  status: "ready" as const,
  devices: [
    {
      controllable: true as const,
      id: "fixture-speaker",
      name: "Fixture Speaker",
      type: "Speaker",
      active: true,
    },
    {
      controllable: true as const,
      id: "fixture-phone",
      name: "Fixture Phone",
      type: "Smartphone",
      active: false,
    },
  ],
  playback: {
    playing: false,
    device: {
      id: "fixture-speaker",
      name: "Fixture Speaker",
      restricted: false,
    },
    item: {
      kind: "track" as const,
      id: "fixture-track",
      name: "Fixture Song",
      artistNames: ["Fixture Artist"],
      imageUrl: null,
    },
    allows: { pause: true, resume: true },
  },
}

async function mountPlayer(page: Page, options: PlayerFixtureOptions = {}) {
  await fakeSpotify(page)
  const fixtureModulePath = "/tests/browser/support/mount-player.tsx"
  await page.goto("/__player_browser_fixture__")
  await page.waitForLoadState("networkidle")
  await page.evaluate(
    async ({ fixtureOptions, modulePath }) => {
      const { mountPlayer: mount } = await import(modulePath)
      mount(fixtureOptions)
    },
    { fixtureOptions: options, modulePath: fixtureModulePath }
  )
  await expect(
    page.getByRole("heading", { name: "Spotify player" })
  ).toBeVisible()
}

async function calls(page: Page) {
  return page.evaluate(() => window.playerFixture.calls)
}

test("mount and choosing a playback target never send playback writes", async ({
  page,
}) => {
  await mountPlayer(page)
  await expect(page.getByText("Paused on Fixture Speaker")).toBeVisible()
  const chooser = page.getByRole("combobox", { name: "Play tracks on" })
  await chooser.click()
  await page.getByRole("option", { name: "Fixture Phone" }).click()
  await expect(chooser).toContainText("Fixture Phone")
  expect((await calls(page)).filter(({ kind }) => kind !== "status")).toEqual(
    []
  )
})

test("an accepted play waits for observed playback and a double click sends one request", async ({
  page,
}) => {
  await mountPlayer(page)
  await page.getByRole("button", { name: "Play Fixture Song" }).dblclick()
  await expect(
    page.getByText("Request sent. Waiting for Spotify…")
  ).toBeVisible()
  await expect(page.getByText("Paused on Fixture Speaker")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toBeDisabled()
  expect((await calls(page)).filter(({ kind }) => kind === "play")).toEqual([
    { kind: "play", deviceId: "fixture-speaker", trackId: "fixture-track" },
  ])
  await page.evaluate((status) => window.playerFixture.setStatus(status), {
    ...fixtureReady,
    playback: { ...fixtureReady.playback, playing: true },
  })
  await expect(page.getByText("Playing on Fixture Speaker")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toHaveAttribute("data-playing", "true")
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toBeEnabled()
})

test("pause targets the observed playback device after choosing a different target", async ({
  page,
}) => {
  await mountPlayer(page, {
    status: {
      ...fixtureReady,
      playback: { ...fixtureReady.playback, playing: true },
    },
  })
  const chooser = page.getByRole("combobox", { name: "Play tracks on" })
  await chooser.click()
  await page.getByRole("option", { name: "Fixture Phone" }).click()
  await page.getByRole("button", { name: "Pause playback" }).click()
  await expect(
    page.getByText("Request sent. Waiting for Spotify…")
  ).toBeVisible()
  expect((await calls(page)).filter(({ kind }) => kind === "pause")).toEqual([
    { kind: "pause", deviceId: "fixture-speaker" },
  ])
})

test("missing playback permission offers reconnection and sends no command", async ({
  page,
}) => {
  await mountPlayer(page, { status: { status: "needs_permission" } })
  await expect(
    page.getByText("Connect Spotify again to allow playback control.")
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Allow playback" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toBeDisabled()
  expect((await calls(page)).filter(({ kind }) => kind !== "status")).toEqual(
    []
  )
})

test("no available devices disables track playback", async ({ page }) => {
  await mountPlayer(page, {
    status: { status: "ready", devices: [], playback: null },
  })
  await expect(
    page.getByText(
      "No devices found. Open Spotify on a device, then refresh playback."
    )
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toBeDisabled()
  expect((await calls(page)).filter(({ kind }) => kind !== "status")).toEqual(
    []
  )
})

test("restricted devices are visible but cannot be selected or played", async ({
  page,
}) => {
  await mountPlayer(page, {
    status: {
      status: "ready",
      devices: [
        {
          controllable: false,
          why: "restricted",
          name: "Fixture TV",
          type: "TV",
          active: true,
        },
      ],
      playback: null,
    },
  })
  await expect(
    page.getByText("These devices cannot be controlled.")
  ).toBeVisible()
  await page.getByRole("combobox", { name: "Play tracks on" }).click()
  await expect(
    page.getByRole("option", { name: "Fixture TV (restricted)" })
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toBeDisabled()
  expect((await calls(page)).filter(({ kind }) => kind !== "status")).toEqual(
    []
  )
})

test("Retry-After blocks manual and automatic status work until the delay expires", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-24T10:00:00Z") })
  await mountPlayer(page, {
    commandError: {
      message: "Spotify asked the fixture to wait",
      data: { reason: "RateLimited", retryAfterSeconds: 5 },
    },
  })
  await expect(page.getByText("Paused on Fixture Speaker")).toBeVisible()
  await page.getByRole("button", { name: "Play Fixture Song" }).click()
  await expect(
    page.getByText(
      "Spotify has asked us to wait. Playback will refresh after the rate limit expires."
    )
  ).toBeVisible()
  const beforeRefresh = (await calls(page)).filter(
    ({ kind }) => kind === "status"
  )
  await expect(
    page.getByRole("button", { name: "Refresh playback" })
  ).toBeDisabled()
  await page.clock.runFor(4_000)
  expect((await calls(page)).filter(({ kind }) => kind === "status")).toEqual(
    beforeRefresh
  )
  await page.clock.runFor(1_000)
  await expect
    .poll(
      async () =>
        (await calls(page)).filter(({ kind }) => kind === "status").length
    )
    .toBeGreaterThan(beforeRefresh.length)
})

test("a status response from before hiding the page is ignored and refreshed on return", async ({
  page,
}) => {
  await mountPlayer(page, {
    status: {
      ...fixtureReady,
      playback: { ...fixtureReady.playback, playing: true },
    },
  })
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toHaveAttribute("data-playing", "true")
  await page.evaluate(() => window.playerFixture.deferNextStatus())
  await page.getByRole("button", { name: "Refresh playback" }).click()
  await expect
    .poll(
      async () =>
        (await calls(page)).filter(({ kind }) => kind === "status").length
    )
    .toBe(2)
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).not.toHaveAttribute("data-playing", "true")
  await page.evaluate((status) => window.playerFixture.setStatus(status), {
    ...fixtureReady,
    playback: { ...fixtureReady.playback, playing: false },
  })
  await page.evaluate(() => window.playerFixture.resolveDeferredStatus())
  await expect(page.getByText("Playing on Fixture Speaker")).toBeVisible()
  await page.evaluate(() => {
    window.playerFixture.deferNextStatus()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect
    .poll(
      async () =>
        (await calls(page)).filter(({ kind }) => kind === "status").length
    )
    .toBe(3)
  await expect(
    page.getByRole("button", { name: "Pause playback" })
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Play Fixture Song" })
  ).toBeDisabled()
  await page.evaluate(() => window.playerFixture.resolveDeferredStatus())
  await expect(page.getByText("Paused on Fixture Speaker")).toBeVisible()
})

test("unmounting ignores a late status response", async ({ page }) => {
  await mountPlayer(page)
  await page.evaluate(() => window.playerFixture.deferNextStatus())
  await page.getByRole("button", { name: "Refresh playback" }).click()
  await expect
    .poll(
      async () =>
        (await calls(page)).filter(({ kind }) => kind === "status").length
    )
    .toBe(2)
  await page.evaluate(() => window.playerFixture.unmount())
  await page.evaluate(() => window.playerFixture.resolveDeferredStatus())
  await expect(
    page.locator('[data-fixture="injected-player-client"]')
  ).toHaveCount(0)
})

test("the browser becomes the idle target and activation does not confirm playback", async ({
  page,
}) => {
  await mountPlayer(page, {
    status: { status: "ready", devices: [], playback: null },
  })
  await expect
    .poll(() => page.evaluate(() => window.fakeSpotify?.connected))
    .toBe(true)
  await page.evaluate(() => {
    window.playerFixture.setStatus({
      status: "ready",
      playback: null,
      devices: [
        {
          controllable: true,
          id: "browser-device",
          name: "Tools browser player",
          type: "Computer",
          active: false,
        },
      ],
    })
    window.fakeSpotify.emit("ready", { device_id: "browser-device" })
  })
  const chooser = page.getByRole("combobox", { name: "Play tracks on" })
  await expect(chooser).toContainText("This browser")
  await page.getByRole("button", { name: "Play Fixture Song" }).click()
  await expect(
    page.getByText("Request sent. Waiting for Spotify…")
  ).toBeVisible()
  expect(await page.evaluate(() => window.fakeSpotify.activatedInGesture)).toBe(
    true
  )
  expect((await calls(page)).filter(({ kind }) => kind === "play")).toEqual([
    { kind: "play", deviceId: "browser-device", trackId: "fixture-track" },
  ])
  await expect(page.getByText("Nothing playing", { exact: true })).toBeVisible()
  await page.evaluate(() => window.fakeSpotify.requestToken())
  await expect
    .poll(() => page.evaluate(() => window.fakeSpotify.tokens.length))
    .toBe(2)
  expect(await page.evaluate(() => window.fakeSpotify.tokens)).toEqual([
    "fixture-sdk-token",
    "fixture-sdk-token",
  ])
  await page.evaluate(() => window.playerFixture.unmount())
  expect(await page.evaluate(() => window.fakeSpotify.disconnected)).toBe(true)
})

for (const [event, message] of [
  ["initialization_error", "This browser cannot initialize Spotify audio."],
  ["authentication_error", "Spotify could not authorize this browser."],
  ["account_error", "Browser playback requires Spotify Premium."],
  ["playback_error", "Spotify could not play audio in this browser."],
  ["not_ready", "This browser is offline."],
] as const) {
  test(`${event} removes the selected browser without falling back to a speaker`, async ({
    page,
  }) => {
    await mountPlayer(page)
    await expect
      .poll(() => page.evaluate(() => window.fakeSpotify?.connected))
      .toBe(true)
    await page.evaluate((status) => {
      window.playerFixture.setStatus({
        ...status,
        devices: [
          ...status.devices,
          {
            controllable: true,
            id: "browser-device",
            name: "Tools browser player",
            type: "Computer",
            active: false,
          },
        ],
      })
      window.fakeSpotify.emit("ready", { device_id: "browser-device" })
    }, fixtureReady)
    await page.getByRole("combobox", { name: "Play tracks on" }).click()
    await page
      .getByRole("option", { name: "This browser", exact: true })
      .click()
    await page.evaluate((name) => window.fakeSpotify.emit(name), event)
    await expect(page.getByText(message, { exact: false })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Play Fixture Song" })
    ).toBeDisabled()
    await expect(
      page.getByText("The selected device is unavailable.", { exact: false })
    ).toBeVisible()
    expect((await calls(page)).filter(({ kind }) => kind !== "status")).toEqual(
      []
    )
  })
}
