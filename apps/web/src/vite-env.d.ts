/// <reference types="vite/client" />
/// <reference types="@tanstack/react-start" />
type PortfolioImageMetadata = Record<
  string,
  { width: number; height: number; version: string }
>

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
