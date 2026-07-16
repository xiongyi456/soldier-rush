export type WeaponId = "rifle" | "smg" | "shotgun" | "sniper" | "rocket" | "laser";

export interface RankDefinition {
  name: string;
  xpToNext: number;
  visualStage: number;
  weapon?: WeaponId;
}

/** Tuned so a full 5-Boss campaign (~2500m) can reach 司令 with normal play. */
export const RANK_DEFS: readonly RankDefinition[] = [
  { name: "新兵", xpToNext: 30, visualStage: 0, weapon: "rifle" },
  { name: "列兵", xpToNext: 40, visualStage: 0 },
  { name: "下士", xpToNext: 50, visualStage: 1, weapon: "smg" },
  { name: "中士", xpToNext: 60, visualStage: 1 },
  { name: "上士", xpToNext: 75, visualStage: 1, weapon: "shotgun" },
  { name: "少尉", xpToNext: 90, visualStage: 2 },
  { name: "中尉", xpToNext: 105, visualStage: 2, weapon: "sniper" },
  { name: "上尉", xpToNext: 120, visualStage: 2 },
  { name: "少校", xpToNext: 140, visualStage: 3 },
  { name: "中校", xpToNext: 160, visualStage: 3, weapon: "rocket" },
  { name: "上校", xpToNext: 185, visualStage: 3 },
  { name: "将军", xpToNext: 210, visualStage: 4 },
  { name: "司令", xpToNext: 280, visualStage: 4, weapon: "laser" },
] as const;

export const MAX_RANK = RANK_DEFS.length;
export const COMMANDER_MERIT = 280;

export function rankName(rank: number): string {
  return RANK_DEFS[Math.max(0, Math.min(MAX_RANK - 1, rank - 1))].name;
}

export function rankXpToNext(rank: number): number {
  return RANK_DEFS[Math.max(0, Math.min(MAX_RANK - 1, rank - 1))].xpToNext;
}

export function weaponForRank(rank: number): WeaponId {
  let weapon: WeaponId = "rifle";
  for (let index = 0; index < Math.min(rank, MAX_RANK); index += 1) {
    weapon = RANK_DEFS[index].weapon ?? weapon;
  }
  return weapon;
}

export function weaponStageForRank(rank: number): number {
  const order: WeaponId[] = ["rifle", "smg", "shotgun", "sniper", "rocket", "laser"];
  return order.indexOf(weaponForRank(rank)) + 1;
}
