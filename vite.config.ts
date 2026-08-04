import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
    host: host || false,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
