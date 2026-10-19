import type { Plugin } from "vite"

/** Check the emitted client graph after TanStack removes server functions. */
export const clientBoundaries = (): Plugin => ({
  name: "tools-client-boundaries",
  generateBundle(_options, bundle) {
    if (this.environment.name !== "client") return
    let modules = 0
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue
      for (const id of Object.keys(chunk.modules)) {
        modules++
        if (
          /\/apps\/tools-backend\//.test(id) ||
          /\/node_modules\/(?:drizzle-orm|hono|@orpc\/server|@modelcontextprotocol\/server)\//.test(
            id
          )
        )
          this.error(`Server implementation reached the browser bundle: ${id}`)
      }
      if (
        /(?:\.|\[\s*["'])(?:BETTER_AUTH_SECRET|SPOTIFY_CLIENT_SECRET|SPOTIFY_TOKEN_ENCRYPTION_KEY|GITHUB_CLIENT_SECRET)\b/.test(
          chunk.code
        )
      )
        this.error(
          `Server configuration reached the browser bundle: ${chunk.fileName}`
        )
    }
    this.info(
      `Verified ${modules} client modules without backend implementation or secret bindings`
    )
  },
})
