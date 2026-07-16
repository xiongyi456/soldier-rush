export const SAVE_KEY_V1 = "soldierRush.save.v1";
export const SAVE_KEY_V2 = "soldierRush.save.v2";

function isNativePlatform(): boolean {
  try {
    // Avoid hard dependency at module top-level for plain web/Pages.
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export interface SaveDataV2 {
  version: 2;
  unlockedWeapons: string[];
  highestBoss: number;
  bestScore: number;
  bestDistance: number;
  prestigeCount: number;
  medals: number;
  quality: "auto" | "high" | "medium" | "low";
}

export function defaultSaveV2(): SaveDataV2 {
  return {
    version: 2,
    unlockedWeapons: ["rifle"],
    highestBoss: 0,
    bestScore: 0,
    bestDistance: 0,
    prestigeCount: 0,
    medals: 0,
    quality: "auto",
  };
}

function sanitize(raw: Partial<SaveDataV2>): SaveDataV2 {
  const base = defaultSaveV2();
  const weaponOrder = ["rifle"];
  const unlocked = weaponOrder.filter(id => raw.unlockedWeapons?.includes(id));
  return {
    version: 2,
    unlockedWeapons: unlocked.includes("rifle") ? unlocked : ["rifle", ...unlocked],
    highestBoss: Math.max(0, Number(raw.highestBoss) || 0),
    bestScore: Math.max(0, Number(raw.bestScore) || 0),
    bestDistance: Math.max(0, Number(raw.bestDistance) || 0),
    prestigeCount: Math.max(0, Number(raw.prestigeCount) || 0),
    medals: Math.min(20, Math.max(0, Number(raw.medals) || 0)),
    quality: raw.quality === "high" || raw.quality === "medium" || raw.quality === "low" ? raw.quality : base.quality,
  };
}

export function loadSaveV2(): SaveDataV2 {
  try {
    const current = localStorage.getItem(SAVE_KEY_V2);
    if (current) return sanitize(JSON.parse(current));
    const legacy = localStorage.getItem(SAVE_KEY_V1);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      const migrated = sanitize({ ...parsed, version: 2, prestigeCount: 0, medals: 0 });
      localStorage.setItem(SAVE_KEY_V2, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // Corrupt or unavailable storage falls back to a clean save.
  }
  return defaultSaveV2();
}

export function persistSaveV2(save: SaveDataV2): void {
  const safe = sanitize(save);
  try { localStorage.setItem(SAVE_KEY_V2, JSON.stringify(safe)); } catch { /* ignored */ }
  if (!isNativePlatform()) return;
  void import("@capacitor/preferences")
    .then(({ Preferences }) => Preferences.set({ key: SAVE_KEY_V2, value: JSON.stringify(safe) }))
    .catch(() => { /* ignored */ });
}

export async function hydrateNativeSave(): Promise<SaveDataV2 | null> {
  if (!isNativePlatform()) return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: SAVE_KEY_V2 });
    if (!value) return null;
    const save = sanitize(JSON.parse(value));
    localStorage.setItem(SAVE_KEY_V2, JSON.stringify(save));
    return save;
  } catch {
    return null;
  }
}
