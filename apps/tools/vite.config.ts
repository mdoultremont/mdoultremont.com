import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"

import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import babel from "@rolldown/plugin-babel"
import { reactCompilerPreset } from "@vitejs/plugin-react"

const config = defineConfig({
  server: { host: "127.0.0.1" },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    // Every page depends on the session, so nothing is prerendered.
    tanstackStart(),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
    }),
  ],
})

export default config
