import { registerSW } from "virtual:pwa-register";
import "./style.css";

type BootGlobal = typeof globalThis & {
  __soldierRushReady?: boolean;
  __soldierRushBooting?: boolean;
  __soldierRushClearCaches?: () => Promise<void>;
  soldierRushHaptic?: (heavy?: boolean) => void;
};

const g = globalThis as BootGlobal;

async function clearSiteCaches(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister()));
    }
  } catch {
    // ignore
  }
}

g.__soldierRushClearCaches = clearSiteCaches;

function setStartButton(label: string, enabled: boolean): void {
  const button = document.getElementById("startBtn") as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = !enabled;
  button.textContent = label;
}

function setLoadStatus(text: string): void {
  const status = document.getElementById("loadStatus");
  if (status) status.textContent = text;
}

function markReady(): void {
  g.__soldierRushReady = true;
  g.__soldierRushBooting = false;
  setStartButton("开始游戏", true);
  setLoadStatus("");
  document.getElementById("loadingScreen")?.classList.add("done");
}

function showBootError(detail: string): void {
  g.__soldierRushBooting = false;
  const loading = document.getElementById("loadingScreen");
  const card = loading?.querySelector<HTMLElement>(".loading-card");
  const safe = detail.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));
  if (card) {
    card.innerHTML =
      "游戏资源加载失败<br><small>请点下方按钮清除缓存后重开<br>" + safe + "</small>";
  }
  loading?.classList.remove("done");
  setLoadStatus("加载失败：" + detail);
  setStartButton("清除缓存并刷新", true);
  const button = document.getElementById("startBtn") as HTMLButtonElement | null;
  if (button) {
    button.onclick = () => {
      void clearSiteCaches().finally(() => {
        const url = new URL(location.href);
        url.searchParams.set("v", String(Date.now()));
        location.replace(url.toString());
      });
    };
  }
}

// PWA: update quietly. Never auto-reload in a loop on mobile.
try {
  let reloadedOnce = sessionStorage.getItem("sr-sw-reloaded") === "1";
  registerSW({
    immediate: true,
    onNeedRefresh() {
      if (reloadedOnce) return;
      reloadedOnce = true;
      sessionStorage.setItem("sr-sw-reloaded", "1");
      location.reload();
    },
  });
} catch {
  // optional
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
    g.soldierRushHaptic = (heavy = false) => {
      void Haptics.impact({ style: heavy ? ImpactStyle.Heavy : ImpactStyle.Light });
    };
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) history.back();
      else App.minimizeApp();
    });
  } catch {
    // Web mode
  }
}

void bootstrapNativeShell();

const boot = () => {
  if (g.__soldierRushBooting || g.__soldierRushReady) return;
  g.__soldierRushBooting = true;
  setLoadStatus("正在下载游戏资源…");

  // Safety: never leave the button stuck forever on mobile networks.
  const watchdog = window.setTimeout(() => {
    if (g.__soldierRushReady) return;
    setLoadStatus("加载偏慢，仍在尝试… 若超过 30 秒请点下方按钮");
  }, 8000);
  const failWatch = window.setTimeout(() => {
    if (g.__soldierRushReady) return;
    showBootError("加载超时。可能是网络慢或旧缓存，请清除缓存后重试。");
  }, 30000);

  void import("./game/game.ts")
    .then(() => {
      window.clearTimeout(watchdog);
      window.clearTimeout(failWatch);
      // game.ts also marks ready after first frame; ensure UI unlock even if that is delayed.
      if (!g.__soldierRushReady) {
        // Give game.ts one frame to finish its own ready hook.
        requestAnimationFrame(() => {
          if (!g.__soldierRushReady) markReady();
        });
      }
    })
    .catch((error: unknown) => {
      window.clearTimeout(watchdog);
      window.clearTimeout(failWatch);
      console.error("Soldier Rush failed to boot", error);
      const detail = error instanceof Error ? error.message : String(error);
      showBootError(detail);
    });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
} else {
  setTimeout(boot, 0);
}
