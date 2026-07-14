export const WEAPON_STAGE_POWER = [2, 3.2, 5, 7.5, 11, 16] as const;
export const MIN_FIRE_INTERVAL = 6;
export const BOSS_TARGET_SECONDS = 12;

export const DAMAGE_VALUES = {
  normal: 8,
  shield: 12,
  heavy: 16,
  gunner: 10,
  spikes: 10,
  mine: 18,
  emp: 6,
} as const;

export const ARMOR_SHARES = {
  standard: .7,
  ranged: .5,
  boss: .35,
} as const;

export type DamageSource = "contact" | "trap" | "ranged" | "boss";

export interface HeroVitals {
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  shield: number;
}

export interface DamageProfile {
  amount: number;
  armorShare: number;
  source: DamageSource;
  allowDodge: boolean;
}

export interface DamageResult extends HeroVitals {
  dodged: boolean;
  shieldConsumed: number;
  armorDamage: number;
  healthDamage: number;
  armorBroken: boolean;
  dead: boolean;
}

export type EnemyArchetype = "fodder" | "normal" | "gunner" | "shield" | "heavy";

export interface RewardCore<TReward = unknown> {
  reward: TReward;
  position: { x: number; z: number };
  life: number;
  collected: boolean;
  pickupRadius: number;
  magnetRadius: number;
}

const ENEMY_HIT_RANGES: Record<EnemyArchetype, readonly [number, number]> = {
  fodder: [.7, 1],
  normal: [1.2, 2.8],
  gunner: [4, 6],
  shield: [5, 7],
  heavy: [8, 12],
};

export function heroMaxHealth(rank: number): number {
  return 100 + Math.max(0, rank - 1) * 4;
}

export function projectileDamage(
  stage: number,
  shotCount: number,
  damageBoost = 0,
  skillBoost = 0,
  medalBoost = 0,
): number {
  const power = WEAPON_STAGE_POWER[Math.max(0, Math.min(WEAPON_STAGE_POWER.length - 1, stage - 1))];
  const normalized = power / Math.pow(Math.max(1, shotCount), .75);
  return normalized * (1 + damageBoost) * (1 + skillBoost) * (1 + medalBoost);
}

export function fireInterval(baseRate: number, fireRateMultiplier = 1, reloadLevel = 0): number {
  return Math.max(MIN_FIRE_INTERVAL, baseRate * fireRateMultiplier * Math.pow(.94, Math.max(0, reloadLevel)));
}

export function enemyHealth(archetype: EnemyArchetype, standardProjectileDamage: number, roll = .5): number {
  const [minHits, maxHits] = ENEMY_HIT_RANGES[archetype];
  const hits = minHits + (maxHits - minHits) * Math.max(0, Math.min(1, roll));
  return Math.max(1, Math.ceil(standardProjectileDamage * hits));
}

export function resolveHeroDamage(vitals: HeroVitals, profile: DamageProfile, didDodge = false): DamageResult {
  const result: DamageResult = {
    ...vitals,
    dodged: didDodge,
    shieldConsumed: 0,
    armorDamage: 0,
    healthDamage: 0,
    armorBroken: false,
    dead: vitals.health <= 0,
  };
  if (didDodge || profile.amount <= 0 || result.dead) return result;
  if (result.shield > 0) {
    result.shield -= 1;
    result.shieldConsumed = 1;
    return result;
  }

  const total = Math.max(1, Math.round(profile.amount));
  const requestedArmorDamage = Math.max(0, Math.round(total * Math.max(0, Math.min(1, profile.armorShare))));
  const directHealthDamage = Math.max(0, total - requestedArmorDamage);
  const absorbedByArmor = Math.min(result.armor, requestedArmorDamage);
  const armorOverflow = requestedArmorDamage - absorbedByArmor;
  result.armor = Math.max(0, result.armor - absorbedByArmor);
  result.health = Math.max(0, result.health - directHealthDamage - armorOverflow);
  result.armorDamage = absorbedByArmor;
  result.healthDamage = directHealthDamage + armorOverflow;
  result.armorBroken = vitals.armor > 0 && result.armor === 0;
  result.dead = result.health <= 0;
  return result;
}

export function bossHealth(bossNumber: number, estimatedDps: number): number {
  const dps = Math.max(1, estimatedDps);
  const base = 240 * Math.pow(1.35, Math.max(0, bossNumber - 1));
  const target = Math.max(base, dps * BOSS_TARGET_SECONDS);
  return Math.round(Math.max(dps * 10, Math.min(dps * 15, target)));
}
