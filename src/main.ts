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

function setButton(text: string, enabled: boolean): void {
  const button = $("startBtn") as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = !enabled;
  button.textContent = text;
}

function setStatus(text: string): void {
  const el = $("loadStatus");
  if (el) el.textContent = text;
}

function setLoadingCard(html: string): void {
  const card = document.querySelector<HTMLElement>("#loadingScreen .loading-card");
  if (card) card.innerHTML = html;
}

function showLoadingOverlay(): void {
  $("loadingScreen")?.classList.remove("done");
}

function hideLoadingOverlay(): void {
  $("loadingScreen")?.classList.add("done");
}

function hardReload(): void {
  void clearSiteCaches().finally(() => {
    const url = new URL(location.href);
    url.searchParams.set("v", String(Date.now()));
    location.replace(url.toString());
  });
}

function bindClearCacheButton(): void {
  const button = $("startBtn") as HTMLButtonElement | null;
  if (!button) return;
  button.onclick = () => hardReload();
}

function showFatal(detail: string): void {
  showLoadingOverlay();
  setLoadingCard(
    "加载失败<br><small>" +
      detail.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c)) +
      "</small>",
  );
  setStatus(detail);
  setButton("清除缓存并刷新", true);
  bindClearCacheButton();
}

function markReadyAndEnableStart(): void {
  g.__soldierRushReady = true;
  hideLoadingOverlay();
  setStatus("");
  setButton("开始游戏", true);
  const button = $("startBtn") as HTMLButtonElement | null;
  if (!button) return;
  button.onclick = null;
  button.addEventListener("click", () => {
    if (typeof g.__soldierRushStart === "function") {
      g.__soldierRushStart();
    } else {
      setStatus("引擎未就绪，请点下方清除缓存");
      setButton("清除缓存并刷新", true);
      bindClearCacheButton();
    }
  });
}

// Optional PWA — no auto reload loops.
try {
  void import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          // 有新版本时清缓存并硬刷新，避免卡在旧包
          hardReload();
        },
      });
    })
    .catch(() => {});
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

/**
 * Classic flow:
 * 1) Full-screen "正在集结部队…"
 * 2) Load 3D game in background
 * 3) Hide overlay, enable "开始游戏"
 * 4) Click starts the run
 */
function boot(): void {
  if (location.protocol === "file:") {
    showFatal("请用 npm run dev 打开，不要双击 html 文件。");
    return;
  }

  showLoadingOverlay();
  setLoadingCard('正在集结部队…<div class="loading-track"><div id="loadingFill"></div></div>');
  setButton("请稍候…", false);
  setStatus("正在加载 3D 资源，请稍候");

  let settled = false;
  const finishOk = () => {
    if (settled) return;
    settled = true;
    markReadyAndEnableStart();
  };
  const finishFail = (detail: string) => {
    if (settled) return;
    settled = true;
    showFatal(detail);
  };

  const slowTip = window.setTimeout(() => {
    if (!settled) setStatus("手机首次加载较慢，请继续等待…（也可稍后点清除缓存）");
  }, 4000);

  // 12s 仍未好：开放「清除缓存」但不阻断继续等
  const softFail = window.setTimeout(() => {
    if (settled) return;
    setStatus("加载偏慢。可继续等，或点按钮清缓存重进。");
    setButton("清除缓存并刷新", true);
    bindClearCacheButton();
  }, 12000);

  const hardFail = window.setTimeout(() => {
    if (!settled) finishFail("加载超时。请点「清除缓存并刷新」，或换网络后重试。");
  }, 60000);

  // 若页面已有旧缓存把 ready 标了却没 start，允许重试
  if (g.__soldierRushReady && typeof g.__soldierRushStart === "function") {
    window.clearTimeout(slowTip);
    window.clearTimeout(softFail);
    window.clearTimeout(hardFail);
    finishOk();
    return;
  }

  void import("./game/game.ts")
    .then(() => {
      window.clearTimeout(slowTip);
      window.clearTimeout(softFail);
      window.clearTimeout(hardFail);
      // game.ts 末尾会设 ready/start；这里再兜底一次
      if (typeof g.__soldierRushStart !== "function") {
        finishFail("游戏引擎未注册开始入口，请清除缓存后重试。");
        return;
      }
      finishOk();
    })
    .catch((error: unknown) => {
      window.clearTimeout(slowTip);
      window.clearTimeout(softFail);
      window.clearTimeout(hardFail);
      console.error("Soldier Rush failed to boot", error);
      const detail = error instanceof Error ? error.message : String(error);
      finishFail("加载失败：" + detail);
    });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
