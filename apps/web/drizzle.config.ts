import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/modules/database/schema.ts",
  out: "./migrations",
})
