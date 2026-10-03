/// <reference types="vite/client" />
/// <reference types="@tanstack/react-start" />
type PortfolioImageMetadata = Record<
  string,
  { width: number; height: number; version: string }
>
interface Env {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GITHUB_OWNER_ID: string
  GITHUB_REDIRECT_URI: string
  JEV_API_KEY: string
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
  SPOTIFY_REDIRECT_URI: string
  SPOTIFY_TOKEN_ENCRYPTION_KEY: string
}

declare namespace Cloudflare {
  interface Env {
    GITHUB_CLIENT_ID: string
    GITHUB_CLIENT_SECRET: string
    GITHUB_OWNER_ID: string
    GITHUB_REDIRECT_URI: string
    JEV_API_KEY: string
    SPOTIFY_CLIENT_ID: string
    SPOTIFY_CLIENT_SECRET: string
    SPOTIFY_REDIRECT_URI: string
    SPOTIFY_TOKEN_ENCRYPTION_KEY: string
  }
}

declare module "virtual:portfolio-images" {
  const metadata: PortfolioImageMetadata
  export default metadata
}

declare module "virtual:brand-images" {
  const metadata: PortfolioImageMetadata
  export default metadata
}

declare module "virtual:profile-images" {
  const metadata: PortfolioImageMetadata
  export default metadata
}

declare module "virtual:photography-images" {
  const metadata: PortfolioImageMetadata
  export default metadata
}
