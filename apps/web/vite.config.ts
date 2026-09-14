import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"

import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import babel from "@rolldown/plugin-babel"
import { reactCompilerPreset } from "@vitejs/plugin-react"
import { readImageMetadata } from "./src/features/images/metadata.build.ts"

function portfolioImageMetadata() {
  const virtualId = "virtual:portfolio-images"
  const resolvedId = `\0${virtualId}`
  return {
    name: "portfolio-image-metadata",
    resolveId(id: string) {
      return id === virtualId ? resolvedId : undefined
    },
    async load(id: string) {
      if (id !== resolvedId) return undefined
      const metadata = await readImageMetadata({ root: process.cwd() })
      return `export default ${JSON.stringify(metadata)}`
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    portfolioImageMetadata(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
    }),
  ],
})

export default config
