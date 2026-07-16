import { describe, expect, it } from "vitest";
import { compactInPlace } from "./compact";

describe("compactInPlace", () => {
  it("removes dead items without reallocating a new array identity", () => {
    const items = [1, 2, 3, 4, 5];
    const dropped: number[] = [];
    compactInPlace(items, value => value % 2 === 1, value => dropped.push(value));
    expect(items).toEqual([1, 3, 5]);
    expect(dropped).toEqual([2, 4]);
  });

  it("keeps all items when nothing dies", () => {
    const items = ["a", "b"];
    compactInPlace(items, () => true);
    expect(items).toEqual(["a", "b"]);
  });
});
