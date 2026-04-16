import {
  completeDelivery,
  failDelivery,
  startDelivery,
} from "../../src/http/dedup-cache";

describe("delivery lifecycle dedup", () => {
  it("returns started on first call for a delivery ID", () => {
    const id = `test-delivery-${Math.random()}`;
    expect(startDelivery(id)).toBe("started");
  });

  it("returns duplicate while the same delivery is in-flight", () => {
    const id = `test-delivery-${Math.random()}`;
    startDelivery(id);
    expect(startDelivery(id)).toBe("duplicate");
  });

  it("allows retry after a failed delivery", () => {
    const id = `test-delivery-${Math.random()}`;
    expect(startDelivery(id)).toBe("started");
    failDelivery(id);
    expect(startDelivery(id)).toBe("started");
  });

  it("keeps completed deliveries deduplicated", () => {
    const id = `test-delivery-${Math.random()}`;
    expect(startDelivery(id)).toBe("started");
    completeDelivery(id);
    expect(startDelivery(id)).toBe("duplicate");
  });
});
