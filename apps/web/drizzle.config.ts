import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/backend/primitives/db/schema.ts",
  out: "./migrations",
})
