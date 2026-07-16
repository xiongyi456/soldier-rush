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

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function startButton(): HTMLButtonElement | null {
  return $("startBtn") as HTMLButtonElement | null;
}

function setStatus(text: string): void {
  const el = $("loadStatus");
  if (el) el.textContent = text;
}

function hideLoadingOverlay(): void {
  $("loadingScreen")?.classList.add("done");
}

function showLoadingOverlay(): void {
  $("loadingScreen")?.classList.remove("done");
}

function hardReload(): void {
  void clearSiteCaches().finally(() => {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("nocache", String(Date.now()));
    location.replace(url.toString());
  });
}

function wireButton(label: string, handler: () => void): void {
  const button = startButton();
  if (!button) return;
  // 永远不要 disabled，避免卡在「请稍候」点不了
  button.disabled = false;
  button.removeAttribute("disabled");
  button.textContent = label;
  button.onclick = handler;
}

function tryStartGame(): void {
  hideLoadingOverlay();
  if (typeof g.__soldierRushStart === "function") {
    try {
      g.__soldierRushStart();
    } catch (error) {
      console.error(error);
      setStatus("开始失败，请清缓存");
      wireButton("清除缓存并刷新", hardReload);
    }
    return;
  }
  setStatus("引擎未就绪，点此清缓存后重进");
  wireButton("清除缓存并刷新", hardReload);
}

function enableStartGame(): void {
  g.__soldierRushReady = true;
  hideLoadingOverlay();
  setStatus("加载完成，点击开始");
  wireButton("开始游戏", tryStartGame);
}

// 不自动更新 SW，避免刷新死循环
try {
  void import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: false });
    })
    .catch(() => {});
} catch {
  // ignore
}

void (async () => {
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
})();

function boot(): void {
  if (location.protocol === "file:") {
    setStatus("请用浏览器打开站点，不要双击本地 html");
    wireButton("清除缓存并刷新", hardReload);
    return;
  }

  showLoadingOverlay();
  setStatus("正在加载 3D 资源…");
  // 立刻可点：不要 disabled
  wireButton("请稍候·点此清缓存", hardReload);

  // 2 秒后若已就绪就改成开始
  window.setTimeout(() => {
    if (typeof g.__soldierRushStart === "function") enableStartGame();
  }, 2000);

  // 6 秒后强制给「开始游戏」入口（即使还在加载，点了会再判断）
  window.setTimeout(() => {
    if (typeof g.__soldierRushStart === "function") enableStartGame();
    else {
      setStatus("仍在加载…可继续等，或清缓存");
      wireButton("清除缓存并刷新", hardReload);
    }
  }, 6000);

  if (typeof g.__soldierRushStart === "function") {
    enableStartGame();
    return;
  }

  const poll = window.setInterval(() => {
    if (typeof g.__soldierRushStart === "function") {
      window.clearInterval(poll);
      enableStartGame();
    }
  }, 150);
  window.setTimeout(() => window.clearInterval(poll), 30000);

  void import("./game/game.ts")
    .then(() => {
      requestAnimationFrame(() => {
        if (typeof g.__soldierRushStart === "function") enableStartGame();
        else {
          setStatus("引擎异常，请清缓存");
          wireButton("清除缓存并刷新", hardReload);
        }
      });
    })
    .catch((error: unknown) => {
      console.error("Soldier Rush failed to boot", error);
      const detail = error instanceof Error ? error.message : String(error);
      setStatus("加载失败：" + detail);
      showLoadingOverlay();
      wireButton("清除缓存并刷新", hardReload);
    });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
