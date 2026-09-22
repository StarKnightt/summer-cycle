import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5421, strictPort: true, open: false },
  preview: { port: 5420, strictPort: true, open: false },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1200 },
});
