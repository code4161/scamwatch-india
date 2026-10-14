import { defineConfig } from "vite"

// Served from GitHub Pages at /scamwatch-india/.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/scamwatch-india/",
  build: { target: "es2022", outDir: "dist" },
})
