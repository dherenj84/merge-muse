import { isDuplicate } from "../../src/http/dedup-cache";

describe("isDuplicate", () => {
  it("returns false on first call for a delivery ID", () => {
    const id = `test-delivery-${Math.random()}`;
    expect(isDuplicate(id)).toBe(false);
  });

  it("returns true on subsequent calls for the same delivery ID", () => {
    const id = `test-delivery-${Math.random()}`;
    isDuplicate(id); // first call — marks as seen
    expect(isDuplicate(id)).toBe(true);
  });

  it("treats different delivery IDs independently", () => {
    const id1 = `test-delivery-${Math.random()}`;
    const id2 = `test-delivery-${Math.random()}`;
    isDuplicate(id1);
    expect(isDuplicate(id2)).toBe(false);
  });
});
