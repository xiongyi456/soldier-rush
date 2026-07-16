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
      registerType: "prompt",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "士兵冲锋 3D：豆丁的司令之路",
        short_name: "士兵冲锋",
        description: "Q版豆丁冲锋：军衔进化、击杀召唤公路五害、技能构筑与授勋转生",
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
        // 避免 HTML/入口被旧 SW 死缓存导致一直「请稍候」
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              networkTimeoutSeconds: 4,
            },
          },
        ],
      },
    }),
  ],
});
