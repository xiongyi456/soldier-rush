import { describe, expect, it } from "vitest";
import { chooseSkillOptions, SKILL_DEFS } from "./skills";

describe("skill choices", () => {
  it("contains the planned skill roster including mechanism skills", () => {
    expect(SKILL_DEFS).toHaveLength(18);
    expect(SKILL_DEFS.map(skill => skill.id)).toEqual(expect.arrayContaining(["ricochet", "mines", "salvo"]));
    expect(SKILL_DEFS.map(skill => skill.id)).not.toContain("orbit");
  });

  it("offers three unique non-maxed options", () => {
    const levels = Object.fromEntries(SKILL_DEFS.map(skill => [skill.id, 0]));
    const choices = chooseSkillOptions(levels, () => .2);
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map(skill => skill.id)).size).toBe(3);
    expect(choices.some(skill => skill.category === "attack")).toBe(true);
    expect(choices.some(skill => skill.category === "defense")).toBe(true);
  });

  it("excludes maxed skills", () => {
    const levels = Object.fromEntries(SKILL_DEFS.map(skill => [skill.id, skill.maxLevel]));
    levels.firepower = 4;
    expect(chooseSkillOptions(levels, () => .1).map(skill => skill.id)).toEqual(["firepower"]);
  });
});
