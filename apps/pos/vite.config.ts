import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Keeps the original hostname, because the API uses it to work out which store is calling.
const target = { target: "http://127.0.0.1:8787", changeOrigin: false };
const proxy = { "/v1": target, "/products": target };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
  server: { proxy },
  preview: { proxy },
});
