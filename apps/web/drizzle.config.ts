import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/backend/modules/database/schema.ts",
  out: "./migrations",
})
