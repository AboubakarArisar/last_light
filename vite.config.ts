import { defineConfig } from "vite";
// The renderer is 127 KB gzip. A separate vendor chunk stays cacheable across game updates.
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
