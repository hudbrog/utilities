import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const appVersion = `${process.env.npm_package_version ?? "0.0.0"}+${process.env.GITHUB_SHA?.slice(0, 7) ?? "dev"}`;

export default defineConfig({
  base: "/utilities/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{css,html,js,json,png,svg,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts", "tools/**/*.test.mjs"],
  },
});
