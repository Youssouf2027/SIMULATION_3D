import { defineConfig } from "vite";
import { resolve } from "path";
export default defineConfig({
  server: { proxy: { "/api": "http://localhost:3001", "/uploads": "http://localhost:3001" } },
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), admin: resolve(__dirname, "admin.html") } } },
});
