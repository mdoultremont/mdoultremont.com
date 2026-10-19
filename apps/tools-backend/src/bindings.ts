/** Capabilities supplied by the single tools Worker host. */
export interface ToolsBindings {
  DB: D1Database
  FILES: R2Bucket
  JOBS: Queue
  EMAIL: SendEmail
  AI: Ai
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  OWNER_ACCOUNTS: string
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
  SPOTIFY_REDIRECT_URI: string
  SPOTIFY_TOKEN_ENCRYPTION_KEY: string
}

declare global {
  namespace Cloudflare {
    interface Env extends ToolsBindings {}
  }
}
