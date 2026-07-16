import { describe, expect, it } from "vitest";
import { MAX_RANK, RANK_DEFS, rankName, weaponForRank, weaponStageForRank } from "./progression";

describe("rank progression", () => {
  it("contains the full recruit-to-commander ladder", () => {
    expect(MAX_RANK).toBe(13);
    expect(rankName(1)).toBe("新兵");
    expect(rankName(13)).toBe("司令");
    expect(RANK_DEFS.every(rank => rank.xpToNext > 0)).toBe(true);
  });

  it("keeps a single rifle and stages power by rank bands", () => {
    expect([1, 3, 5, 7, 10, 13].map(weaponForRank)).toEqual(["rifle", "rifle", "rifle", "rifle", "rifle", "rifle"]);
    expect(weaponStageForRank(1)).toBe(1);
    expect(weaponStageForRank(5)).toBe(3);
    expect(weaponStageForRank(9)).toBe(4);
    expect(weaponStageForRank(13)).toBe(6);
  });
});
