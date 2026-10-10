import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/backend/primitives/database/schema.ts",
  out: "./migrations",
})
