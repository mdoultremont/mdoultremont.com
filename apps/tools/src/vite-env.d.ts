/// <reference types="vite/client" />
/// <reference types="@tanstack/react-start" />
interface Env {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  JEV_API_KEY: string
  OWNER_ACCOUNTS: string
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
  SPOTIFY_REDIRECT_URI: string
  SPOTIFY_TOKEN_ENCRYPTION_KEY: string
}

declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL: string
    GITHUB_CLIENT_ID: string
    GITHUB_CLIENT_SECRET: string
    JEV_API_KEY: string
    OWNER_ACCOUNTS: string
    SPOTIFY_CLIENT_ID: string
    SPOTIFY_CLIENT_SECRET: string
    SPOTIFY_REDIRECT_URI: string
    SPOTIFY_TOKEN_ENCRYPTION_KEY: string
  }
}
