import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://localhost:3001",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
