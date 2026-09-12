import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          physics: ["@dimforge/rapier3d-compat"],
          graphics: ["three"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
