import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const BUILD_TAG = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  base: "./",
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TAG),
  },
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@capacitor")) return "capacitor";
          return undefined;
        },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "士兵冲锋 3D：司令之路",
        short_name: "士兵冲锋",
        description: "原创战斗Q版单人3D冲锋游戏：军衔、技能构筑、Boss与转生",
        lang: "zh-CN",
        display: "fullscreen",
        orientation: "any",
        theme_color: "#10192d",
        background_color: "#10192d",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,glb,ktx2}"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: null,
        // Don't cache opaque/cross-origin failures that can break mobile boots.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "script" || request.destination === "style",
            handler: "NetworkFirst",
            options: {
              cacheName: "soldier-rush-runtime",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
});
