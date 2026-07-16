/** Per-stage total firepower budget. Growth stays gentle so multi-shot stages do not melt fodder. */
export const WEAPON_STAGE_POWER = [2, 2.9, 4.2, 5.8, 7.6, 9.6] as const;
export const MIN_FIRE_INTERVAL = 7;
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

/** Hits needed if a single projectile lands. Multi-shot / dense stages compensated in enemyHealth. */
const ENEMY_HIT_RANGES: Record<EnemyArchetype, readonly [number, number]> = {
  fodder: [2.4, 3.6],
  normal: [3.8, 6.0],
  gunner: [7, 10],
  shield: [9, 13],
  heavy: [14, 20],
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
  // Stronger multi-shot split so dense volleys do not overkill a single lane.
  const normalized = power / Math.pow(Math.max(1, shotCount), .92);
  return normalized * (1 + damageBoost) * (1 + skillBoost) * (1 + medalBoost);
}

export function fireInterval(baseRate: number, fireRateMultiplier = 1, reloadLevel = 0): number {
  return Math.max(MIN_FIRE_INTERVAL, baseRate * fireRateMultiplier * Math.pow(.94, Math.max(0, reloadLevel)));
}

export function enemyHealth(
  archetype: EnemyArchetype,
  standardProjectileDamage: number,
  roll = .5,
  shotCount = 1,
): number {
  const [minHits, maxHits] = ENEMY_HIT_RANGES[archetype];
  const hits = minHits + (maxHits - minHits) * Math.max(0, Math.min(1, roll));
  // Dense multi-shot stages often land several bullets on one fodder; pad harder than log2*0.42.
  const shots = Math.max(1, shotCount);
  const volley = 1 + Math.log2(shots) * .72 + Math.max(0, shots - 3) * .08;
  return Math.max(1, Math.ceil(standardProjectileDamage * hits * volley));
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
