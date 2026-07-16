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
  it("keeps projectile growth smooth across stages (single rifle)", () => {
    const values = [1, 2, 3, 4, 5, 6].map(stage => projectileDamage(stage, 1));
    expect(values.every(value => value > 0)).toBe(true);
    expect(values[5] / values[0]).toBeLessThan(3);
    expect(values[5] / values[0]).toBeGreaterThan(1.5);
  });

  it("respects rifle cadence and the safety floor", () => {
    expect(fireInterval(22)).toBe(22);
    expect(fireInterval(22, .5, 0)).toBe(11);
    expect(fireInterval(6, .5, 5)).toBe(6);
  });

  it("uses archetype hit-count bands", () => {
    const damage = 2;
    expect(enemyHealth("fodder", damage, 1)).toBe(4);
    expect(enemyHealth("gunner", damage, .5)).toBe(10);
    expect(enemyHealth("heavy", damage, .5)).toBe(20);
  });

  it("keeps early fodder clearable with a single rifle", () => {
    const damage = projectileDamage(1, 1);
    const fodder = enemyHealth("fodder", damage, .5, 1);
    // About 1–2 hits with starter rifle.
    expect(fodder / damage).toBeGreaterThanOrEqual(1.1);
    expect(fodder / damage).toBeLessThanOrEqual(2.2);
    expect(enemyHealth("normal", damage, .5, 1) / damage).toBeGreaterThanOrEqual(2);
    expect(enemyHealth("heavy", damage, .5, 1) / damage).toBeGreaterThanOrEqual(8);
  });

  it("targets an eleven to sixteen second boss window", () => {
    const dps = 100;
    const hp = bossHealth(3, dps);
    expect(hp / dps).toBeGreaterThanOrEqual(11);
    expect(hp / dps).toBeLessThanOrEqual(16);
  });

  it("keeps the boss window bounded across rifle stages", () => {
    for (let stage = 1; stage <= 6; stage += 1) {
      const dps = projectileDamage(stage, 1) * 60 / fireInterval(22);
      const duration = bossHealth(stage, dps) / dps;
      expect(duration).toBeGreaterThanOrEqual(11);
      expect(duration).toBeLessThanOrEqual(16.2);
    }
  });
});
