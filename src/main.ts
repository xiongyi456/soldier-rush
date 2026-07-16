import "./style.css";

type BootGlobal = typeof globalThis & {
  __soldierRushReady?: boolean;
  __soldierRushStart?: () => void;
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

function setButton(text: string, enabled = true): void {
  const button = document.getElementById("startBtn") as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = !enabled;
  button.textContent = text;
}

function setStatus(text: string): void {
  const el = document.getElementById("loadStatus");
  if (el) el.textContent = text;
}

function hideLoading(): void {
  document.getElementById("loadingScreen")?.classList.add("done");
}

function showFatal(detail: string): void {
  hideLoading();
  setStatus(detail);
  setButton("清除缓存并刷新", true);
  const button = document.getElementById("startBtn") as HTMLButtonElement | null;
  if (!button) return;
  button.onclick = () => {
    void clearSiteCaches().finally(() => {
      const url = new URL(location.href);
      url.searchParams.set("v", String(Date.now()));
      location.replace(url.toString());
    });
  };
}

// Optional PWA: never auto-reload (that was locking mobile on "加载中").
try {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  }).catch(() => {
    // no sw in dev
  });
} catch {
  // ignore
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
    // web
  }
}

void bootstrapNativeShell();

let loadPromise: Promise<void> | null = null;

function loadGame(): Promise<void> {
  if (g.__soldierRushReady) return Promise.resolve();
  if (loadPromise) return loadPromise;

  setButton("加载中…", false);
  setStatus("正在下载 3D 引擎，首次约需几秒…");

  loadPromise = import("./game/game.ts")
    .then(() => {
      g.__soldierRushReady = true;
      setStatus("");
      setButton("开始游戏", true);
      hideLoading();
    })
    .catch((error: unknown) => {
      loadPromise = null;
      console.error("Soldier Rush failed to boot", error);
      const detail = error instanceof Error ? error.message : String(error);
      showFatal("加载失败：" + detail);
      throw error;
    });

  return loadPromise;
}

function wireStartButton(): void {
  const button = document.getElementById("startBtn") as HTMLButtonElement | null;
  if (!button) return;

  // Page is interactive immediately — do NOT leave users stuck on disabled loading.
  button.disabled = false;
  button.textContent = "开始游戏";
  setStatus("点击开始后加载游戏资源");
  hideLoading();

  button.addEventListener("click", async (event) => {
    // Let game.ts handler run only after module is ready.
    if (!g.__soldierRushReady) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        await loadGame();
        // Prefer game-exported start if available.
        if (typeof g.__soldierRushStart === "function") g.__soldierRushStart();
        else button.click();
      } catch {
        // error UI already shown
      }
    }
  }, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireStartButton, { once: true });
} else {
  wireStartButton();
}

// Warm the game chunk in background so first click is faster, but never block UI.
window.setTimeout(() => {
  void loadGame().catch(() => {
    // Keep recovery button if warm load fails.
  });
}, 600);
