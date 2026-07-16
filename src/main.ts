import { registerSW } from "virtual:pwa-register";
import "./style.css";

// Avoid blocking first paint on mobile; SW updates in background.
try {
  registerSW({ immediate: false });
} catch {
  // PWA optional on plain static hosts.
}

type BootGlobal = typeof globalThis & {
  __soldierRushReady?: boolean;
  soldierRushHaptic?: (heavy?: boolean) => void;
};

function showBootError(detail: string): void {
  const loading = document.getElementById("loadingScreen");
  const card = loading?.querySelector<HTMLElement>(".loading-card");
  const safe = detail.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));
  if (card) {
    card.innerHTML =
      "游戏资源加载失败<br><small>请强制刷新页面，或清除站点缓存后重开<br>" + safe + "</small>";
  }
  loading?.classList.remove("done");
  const status = document.getElementById("loadStatus");
  if (status) status.textContent = "加载失败：" + detail;
  const button = document.getElementById("startBtn") as HTMLButtonElement | null;
  if (button) {
    button.disabled = false;
    button.textContent = "点我重试刷新";
    button.onclick = () => location.reload();
  }
}

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
    (globalThis as BootGlobal).soldierRushHaptic = (heavy = false) => {
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

// Load the heavy game module after first paint so the loading UI can show on mobile.
const boot = () => {
  void import("./game/game.ts")
    .then(() => {
      (globalThis as BootGlobal).__soldierRushReady = true;
      const button = document.getElementById("startBtn") as HTMLButtonElement | null;
      if (button) {
        button.disabled = false;
        if (!button.textContent || button.textContent.includes("加载") || button.textContent.includes("资源")) {
          button.textContent = "开始游戏";
        }
      }
      const status = document.getElementById("loadStatus");
      if (status) status.textContent = "";
      document.getElementById("loadingScreen")?.classList.add("done");
    })
    .catch((error: unknown) => {
      console.error("Soldier Rush failed to boot", error);
      const detail = error instanceof Error ? error.message : String(error);
      showBootError(detail);
    });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(boot), { once: true });
} else {
  requestAnimationFrame(boot);
}
