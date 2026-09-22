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
  const modules = {
    "virtual:portfolio-images": {},
    "virtual:brand-images": {
      directories: ["public/media/brand/face"],
      contentFiles: [],
    },
    "virtual:profile-images": {
      directories: ["public/media/profile"],
      contentFiles: ["content/profile.json"],
    },
    "virtual:photography-images": {
      directories: ["public/media/photography"],
      contentFiles: ["content/photography.json"],
    },
  }
  return {
    name: "portfolio-image-metadata",
    resolveId(id: string) {
      return id in modules ? `\0${id}` : undefined
    },
    async load(id: string) {
      const virtualId = id.slice(1) as keyof typeof modules
      if (!(virtualId in modules)) return undefined
      const metadata = await readImageMetadata({
        root: process.cwd(),
        ...modules[virtualId],
      })
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
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
      },
    }),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
    }),
  ],
})

export default config
