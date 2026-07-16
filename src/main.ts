import { registerSW } from "virtual:pwa-register";
import "./style.css";

// Avoid blocking first paint on mobile; force SW refresh so phones leave stale caches.
try {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      // New deploy available — reload once to pick up fresh JS/CSS.
      location.reload();
    },
    onOfflineReady() {
      // Cached for offline; no-op.
    },
  });
} catch {
  // PWA optional on plain static hosts.
}

// One-shot recovery: if a previous SW left the app stuck, clear site caches after long failures.
async function clearSiteCaches(): Promise<void> {
  try {
    if (!("caches" in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister()));
    }
  } catch {
    // ignore
  }
}

(globalThis as typeof globalThis & { __soldierRushClearCaches?: () => Promise<void> }).__soldierRushClearCaches = clearSiteCaches;

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
    button.textContent = "清除缓存并刷新";
    button.onclick = () => {
      void clearSiteCaches().finally(() => {
        const url = new URL(location.href);
        url.searchParams.set("v", String(Date.now()));
        location.replace(url.toString());
      });
    };
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
  // game.ts sets __soldierRushReady after the first rendered frame.
  void import("./game/game.ts").catch((error: unknown) => {
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
