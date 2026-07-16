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

function setButton(text: string, enabled: boolean): void {
  const button = startButton();
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
    // 去掉旧 query 再加新 v，避免无限叠加
    url.search = "";
    url.searchParams.set("v", String(Date.now()));
    location.replace(url.toString());
  });
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
  const button = startButton();
  if (button) button.onclick = () => hardReload();
}

function tryStartGame(): void {
  if (typeof g.__soldierRushStart === "function") {
    hideLoadingOverlay();
    g.__soldierRushStart();
    return;
  }
  setStatus("还在加载中…若超过 10 秒请清缓存");
  setButton("清除缓存并刷新", true);
  const button = startButton();
  if (button) button.onclick = () => hardReload();
}

function enableStartGame(): void {
  g.__soldierRushReady = true;
  hideLoadingOverlay();
  setStatus("");
  const button = startButton();
  if (!button) return;
  button.disabled = false;
  button.textContent = "开始游戏";
  button.onclick = () => tryStartGame();
}

function enableClearCache(label = "清除缓存并刷新"): void {
  const button = startButton();
  if (!button) return;
  button.disabled = false;
  button.textContent = label;
  button.onclick = () => hardReload();
}

// PWA 只注册，绝不自动刷新（自动刷新会死循环卡在请稍候）
try {
  void import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: false });
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

function boot(): void {
  if (location.protocol === "file:") {
    showFatal("请用 npm run dev 打开，不要双击 html 文件。");
    return;
  }

  showLoadingOverlay();
  setLoadingCard('正在集结部队…<div class="loading-track"><div id="loadingFill"></div></div>');
  setButton("请稍候…", false);
  setStatus("正在加载 3D 资源…");

  // 任何路径：5 秒后按钮绝不再是 disabled，至少能清缓存
  window.setTimeout(() => {
    const button = startButton();
    if (!button) return;
    if (typeof g.__soldierRushStart === "function") {
      enableStartGame();
      return;
    }
    if (button.disabled || button.textContent === "请稍候…") {
      setStatus("加载中…可继续等，或点按钮清缓存");
      enableClearCache();
    }
  }, 5000);

  // 已挂上引擎：直接可玩
  if (typeof g.__soldierRushStart === "function") {
    enableStartGame();
    return;
  }

  // 轮询：模块一挂上 start 就亮按钮
  let polls = 0;
  const poll = window.setInterval(() => {
    polls += 1;
    if (typeof g.__soldierRushStart === "function") {
      window.clearInterval(poll);
      enableStartGame();
      return;
    }
    if (polls >= 100) window.clearInterval(poll); // ~20s
  }, 200);

  void import("./game/game.ts")
    .then(() => {
      // 再等一帧，确保末尾赋值完成
      requestAnimationFrame(() => {
        if (typeof g.__soldierRushStart === "function") enableStartGame();
        else {
          setStatus("引擎加载异常，请清缓存");
          enableClearCache();
        }
      });
    })
    .catch((error: unknown) => {
      console.error("Soldier Rush failed to boot", error);
      const detail = error instanceof Error ? error.message : String(error);
      showFatal("加载失败：" + detail);
    });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
