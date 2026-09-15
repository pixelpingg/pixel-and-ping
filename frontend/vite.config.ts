import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// API_PROXY_TARGET lets the same frontend dev server point at either
// backend without code changes:
//   - Cloudflare Worker backend (worker/), via `wrangler dev`: http://127.0.0.1:8787
// The Cloudflare-native project uses the Worker as the local API by default.
// Override with frontend/.env.local only if you intentionally use another API.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET || "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      },
    },
  };
});
