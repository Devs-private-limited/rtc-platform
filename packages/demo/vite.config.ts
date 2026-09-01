import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/demo/",
  resolve: {
    alias: {
      "@rtc/sdk": path.resolve(__dirname, "../sdk/src/index.ts"),
    },
  },
  server: {
    port: 5180,
    proxy: {
      "/v1": "http://localhost:4000",
      "/ws": {
        target: "ws://localhost:4000",
        ws: true,
      },
    },
  },
});
