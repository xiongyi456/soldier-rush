export type WeaponId = "rifle";

export interface RankDefinition {
  name: string;
  xpToNext: number;
  visualStage: number;
}

/**
 * Target pace (normal play, 5-Boss campaign):
 * Boss1 ≈ 列兵–下士 · Boss2 ≈ 上士 · Boss3 ≈ 中尉 · Boss4 ≈ 中校 · Boss5 ≈ 将军–司令
 * Total ladder XP (新兵→司令) ≈ 1835; kill XP is small so ranks drip, not explode.
 * Single weapon: always 机关枪. Power stage rises with rank; AS/ATK mainly from gates & crates.
 */
/**
 * 前两级快一点摸到下士；3 级（下士）之后抬高门槛，避免连升。
 * Boss 仍按军衔召唤：3/5/7/9/11。
 */
export const RANK_DEFS: readonly RankDefinition[] = [
  { name: "新兵", xpToNext: 45, visualStage: 0 },
  { name: "列兵", xpToNext: 70, visualStage: 0 },
  { name: "下士", xpToNext: 120, visualStage: 1 },
  { name: "中士", xpToNext: 160, visualStage: 1 },
  { name: "上士", xpToNext: 200, visualStage: 1 },
  { name: "少尉", xpToNext: 250, visualStage: 2 },
  { name: "中尉", xpToNext: 300, visualStage: 2 },
  { name: "上尉", xpToNext: 360, visualStage: 2 },
  { name: "少校", xpToNext: 430, visualStage: 3 },
  { name: "中校", xpToNext: 510, visualStage: 3 },
  { name: "上校", xpToNext: 600, visualStage: 3 },
  { name: "将军", xpToNext: 700, visualStage: 4 },
  { name: "司令", xpToNext: 800, visualStage: 4 },
] as const;

export const MAX_RANK = RANK_DEFS.length;
export const COMMANDER_MERIT = 400;

export function rankName(rank: number): string {
  return RANK_DEFS[Math.max(0, Math.min(MAX_RANK - 1, rank - 1))].name;
}

export function rankXpToNext(rank: number): number {
  return RANK_DEFS[Math.max(0, Math.min(MAX_RANK - 1, rank - 1))].xpToNext;
}

/** Always the one machine gun — no multi-weapon evolution. */
export function weaponForRank(_rank: number): WeaponId {
  return "rifle";
}

/** Power budget stage 1–6 by rank bands (not separate gun types). */
export function weaponStageForRank(rank: number): number {
  if (rank >= 12) return 6;
  if (rank >= 10) return 5;
  if (rank >= 7) return 4;
  if (rank >= 5) return 3;
  if (rank >= 3) return 2;
  return 1;
}
