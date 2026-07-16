import { describe, expect, it } from "vitest";
import { nextEventDistance, pickRunEvent, RUN_EVENTS } from "./events";

describe("run events", () => {
  it("rotates through elite airdrop and horde", () => {
    expect(RUN_EVENTS).toHaveLength(3);
    expect(pickRunEvent(0).type).toBe("elite");
    expect(pickRunEvent(1).type).toBe("airdrop");
    expect(pickRunEvent(2).type).toBe("horde");
    expect(pickRunEvent(3).type).toBe("elite");
  });

  it("schedules events on a steady mid-run cadence", () => {
    expect(nextEventDistance(0, 0)).toBe(180);
    expect(nextEventDistance(200, 1)).toBe(360);
    expect(nextEventDistance(500, 2)).toBe(540);
  });
});
