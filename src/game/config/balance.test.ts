import { describe, expect, it } from "vitest";
import {
  ARMOR_SHARES,
  bossHealth,
  enemyHealth,
  fireInterval,
  heroMaxHealth,
  projectileDamage,
  resolveHeroDamage,
} from "./balance";

describe("hero vitals", () => {
  const vitals = { health: 100, maxHealth: 100, armor: 30, maxArmor: 30, shield: 0 };

  it("splits standard damage between armor and health", () => {
    const result = resolveHeroDamage(vitals, { amount: 10, armorShare: ARMOR_SHARES.standard, source: "trap", allowDodge: true });
    expect(result.armorDamage).toBe(7);
    expect(result.healthDamage).toBe(3);
    expect(result.health).toBe(97);
    expect(result.armor).toBe(23);
  });

  it("moves unabsorbed armor damage into health", () => {
    const result = resolveHeroDamage({ ...vitals, armor: 2 }, { amount: 10, armorShare: .7, source: "contact", allowDodge: true });
    expect(result.armor).toBe(0);
    expect(result.healthDamage).toBe(8);
    expect(result.armorBroken).toBe(true);
  });

  it("consumes one shield layer before vitals", () => {
    const result = resolveHeroDamage({ ...vitals, shield: 2 }, { amount: 18, armorShare: .35, source: "boss", allowDodge: true });
    expect(result.shield).toBe(1);
    expect(result.health).toBe(100);
    expect(result.armor).toBe(30);
  });

  it("makes boss skills visibly damage health", () => {
    const result = resolveHeroDamage(vitals, { amount: 14, armorShare: ARMOR_SHARES.boss, source: "boss", allowDodge: true });
    expect(result.armorDamage).toBe(5);
    expect(result.healthDamage).toBe(9);
    expect(result.health).toBe(91);
  });

  it("only dies when health reaches zero", () => {
    const armorBroken = resolveHeroDamage({ ...vitals, armor: 1 }, { amount: 2, armorShare: 1, source: "trap", allowDodge: true });
    expect(armorBroken.dead).toBe(false);
    const dead = resolveHeroDamage({ ...vitals, health: 5, armor: 0 }, { amount: 8, armorShare: .7, source: "contact", allowDodge: true });
    expect(dead.dead).toBe(true);
  });

  it("scales maximum health through commander", () => {
    expect(heroMaxHealth(1)).toBe(100);
    expect(heroMaxHealth(13)).toBe(148);
  });
});

describe("combat pacing", () => {
  const shots = [1, 3, 7, 9, 13, 13];

  it("keeps projectile growth smooth across stages", () => {
    const values = [1, 2, 3, 4, 5, 6].map((stage, index) => projectileDamage(stage, shots[index]));
    expect(values.every(value => value > 0)).toBe(true);
    expect(values[5] / values[0]).toBeLessThan(1.8);
  });

  it("inherits the fastest weapon cadence without passing the safety floor", () => {
    expect([24, 9, 9, 9, 9, 7].map(rate => fireInterval(rate))).toEqual([24, 9, 9, 9, 9, 7]);
    expect(fireInterval(7, .65, 5)).toBe(7);
  });

  it("uses archetype hit-count bands", () => {
    const damage = 2;
    expect(enemyHealth("fodder", damage, 1)).toBe(8);
    expect(enemyHealth("gunner", damage, .5)).toBe(17);
    expect(enemyHealth("heavy", damage, .5)).toBe(34);
  });

  it("scales enemy HP with multi-shot volleys so fodder is not one-shot", () => {
    for (let stage = 1; stage <= 6; stage += 1) {
      const count = shots[stage - 1];
      const damage = projectileDamage(stage, count);
      const fodder = enemyHealth("fodder", damage, .5, count);
      const volley = damage * Math.min(count, 3);
      // Need more than one multi-hit volley even after weapon upgrades.
      expect(fodder / volley).toBeGreaterThanOrEqual(1.05);
      expect(enemyHealth("normal", damage, .5, count) / damage).toBeGreaterThanOrEqual(5);
      expect(enemyHealth("heavy", damage, .5, count) / damage).toBeGreaterThanOrEqual(17);
    }
  });

  it("targets a ten to fifteen second boss window", () => {
    const dps = 100;
    const hp = bossHealth(3, dps);
    expect(hp / dps).toBeGreaterThanOrEqual(10);
    expect(hp / dps).toBeLessThanOrEqual(15);
  });

  it("keeps the boss window bounded across all weapon stages", () => {
    const cadences = [24, 9, 9, 9, 9, 7];
    for (let stage = 1; stage <= 6; stage += 1) {
      const dps = projectileDamage(stage, shots[stage - 1]) * shots[stage - 1] * 60 / fireInterval(cadences[stage - 1]);
      const duration = bossHealth(stage, dps) / dps;
      expect(duration).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThanOrEqual(15.05);
    }
  });
});
