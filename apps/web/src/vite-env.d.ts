/// <reference types="vite/client" />
/// <reference types="@tanstack/react-start" />
declare module "virtual:portfolio-images" {
  const metadata: Record<
    string,
    { width: number; height: number; version: string }
  >
  export default metadata
}
