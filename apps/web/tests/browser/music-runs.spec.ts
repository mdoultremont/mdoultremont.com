import { expect, test } from "@playwright/test"

test("owner pauses scheduling and starts a clearly labeled asynchronous full run", async ({
  page,
}) => {
  let enabled = true
  let runs: {
    id: string
    mode: string
    status: string
    phase: string
    scanned: number
    processed: number
    delivered: number
    error: null
  }[] = []
  await page.route("**/api/music/runs", async (route) => {
    const request = route.request()
    if (request.method() !== "GET") {
      expect(request.headers()["x-csrf-token"]).toBe("test-csrf")
      const body = request.postDataJSON()
      if (request.method() === "PUT") enabled = body.enabled
      else
        runs = [
          {
            id: "run-123",
            mode: body.mode,
            status: "queued",
            phase: "discover",
            scanned: 0,
            processed: 0,
            delivered: 0,
            error: null,
          },
        ]
    }
    await route.fulfill({
      json: { automationEnabled: enabled, evaluation: "pending", runs },
    })
  })
  await page.goto("/music")
  await page.evaluate(async (modulePath) => {
    const module = await import(modulePath)
    module.mountMusicRuns()
  }, "/tests/browser/support/mount-music-runs.tsx")
  const panel = page.getByRole("region", { name: "Music runs" })
  await expect(panel.getByText(/Dry-run mode/)).toBeVisible()
  await panel.getByLabel("Hourly catch-up").uncheck()
  await expect(panel.getByLabel("Hourly catch-up")).not.toBeChecked()
  await expect(
    panel.getByRole("button", { name: "Catch up new likes" })
  ).toBeEnabled()
  await expect(
    panel.getByRole("button", { name: "Full reclassification" })
  ).toBeVisible()
  await panel
    .getByRole("button", { name: "Full run · restore missing entries" })
    .click()
  await expect(panel.getByText("Run run-123")).toBeVisible()
  await expect(panel.getByText("full · queued · discover")).toBeVisible()
})
