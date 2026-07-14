import { registerSW } from "virtual:pwa-register";
import "./style.css";

registerSW({ immediate: true });

async function bootstrapNativeShell(): Promise<void> {
  try {
    const [{ Capacitor }, { App }, { StatusBar, Style }, { Haptics, ImpactStyle }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/app"),
      import("@capacitor/status-bar"),
      import("@capacitor/haptics"),
    ]);
    if (!Capacitor.isNativePlatform()) return;
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
    (globalThis as typeof globalThis & { soldierRushHaptic?: (heavy?: boolean) => void }).soldierRushHaptic = (heavy = false) => {
      void Haptics.impact({ style: heavy ? ImpactStyle.Heavy : ImpactStyle.Light });
    };
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) history.back();
      else App.minimizeApp();
    });
  } catch {
    // Web/PWA mode does not require native plugins.
  }
}

void bootstrapNativeShell();
void import("./game/game.ts").catch((error: unknown) => {
  console.error("Soldier Rush failed to boot", error);
  const loading = document.getElementById("loadingScreen");
  const card = loading?.querySelector<HTMLElement>(".loading-card");
  if (card) card.innerHTML = "游戏资源加载失败<br><small>请刷新页面，或使用 npm run dev 启动</small>";
  loading?.classList.remove("done");
});
