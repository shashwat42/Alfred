import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

const host = process.env.TAURI_DEV_HOST

export default defineConfig(({ mode, command }) => {
  const config = loadEnv(mode, process.cwd(), "MODE")
  const runtimeMode = process.env.MODE ?? config.MODE ?? "production"
  if (!["development", "production"].includes(runtimeMode)) throw new Error("MODE must be development or production")
  return {
  define: { __DEV_PREVIEW__: JSON.stringify(runtimeMode === "development" && (command === "serve" || mode === "development")) },
  plugins: [
    react(),
    tailwindcss(),
  ],

  worker: {
    format: "es",
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  clearScreen: false,

  // Scan only the app entry, not generated Android reports or bundled assets.
  optimizeDeps: { entries: ["index.html"] },

  server: {
    port: 5173,
    strictPort: true,
    // One dual-stack listener keeps localhost and IPv4 on the same server.
    // Separate IPv4/IPv6 servers can otherwise share a port and corrupt deps.
    host: host || "::",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/wrapper/**"],
    },
  },
}})
