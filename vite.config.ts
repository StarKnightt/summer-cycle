import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5421, strictPort: true, open: false },
  preview: { port: 5420, strictPort: true, open: false },
  build: {
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      output: {
        // three ships as core + WebGL module + addons; separate vendor chunks load in parallel and cache.
        codeSplitting: {
          groups: [
            { name: "three-core", test: /node_modules[\\/].*three[\\/]build[\\/]three\.core/, priority: 2 },
            { name: "three", test: /node_modules[\\/].*three[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
