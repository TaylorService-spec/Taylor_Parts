// THE REORDER POINT — a calculated zero is not a governed zero.
//
// Owner ruling, 2026-08-30: a reorder point must not be presented as an operationally meaningful
// number when the same card says "Insufficient usage history". Show "Not established" instead —
// UNLESS EOS can establish that zero is itself the actual governed value.
//
// That escape clause is what this suite closes, and it closes it with arithmetic rather than with a
// description of arithmetic:
//
//   reorderPoint  = avgDailyUsage * leadTimeDays + avgDailyUsage * safetyFactor
//                 = avgDailyUsage * (leadTimeDays + safetyFactor)
//   avgDailyUsage = totalConsumed / windowDays
//
// so a zero reorder point and an absent usage history are the SAME condition, not two conditions
// that happen to coincide. There is no consumption pattern that yields a governed zero, and the
// metadata register agrees from the other side: PART_REORDER_POINT_IS_DERIVED — "calculated from
// usage, NOT stored on the Part". There is nothing stored for a governed zero to come from.
//
// ============================ WHY THIS SUITE IS SEPARATE ============================
//
// It needs the REAL analytics engine and the REAL display rule together, and neither of the two
// existing Parts suites can host it:
//
//   test/partsNorthStarProjection.test.mjs  is node:test, and cannot import either module —
//                                           inventoryAnalyticsEngine.ts uses extensionless imports,
//                                           and partsNorthStar.js reads Vite's build-time
//                                           __APP_READINESS__ global.
//   test/partsNorthStarRecord.test.jsx      MOCKS inventoryAnalyticsEngine, so importing the real
//                                           one there returns the mock and proves nothing.
//
// So: vitest, and deliberately no mocks at all.
import { describe, it, expect } from "vitest";

import { partReorderPointDisplay } from "../src/domain/partsNorthStar.js";
import { calculateUsageRate, generateReplenishmentRecommendation } from "../src/domain/inventoryAnalyticsEngine";

// Health built by the REAL engine from real consumption, so the tests below agree with what the
// system actually produces rather than with a hand-written fiction of it.
function healthFor(consumedQuantities) {
  const now = Date.now();
  const transactions = consumedQuantities.map((quantity, i) => ({
    id: `t${i}`,
    partId: "P-1",
    workOrderId: "WO-1",
    type: "CONSUMED",
    quantity,
    timestamp: now - (i + 1) * 24 * 60 * 60 * 1000,
  }));
  const usage = calculateUsageRate("P-1", transactions);
  return { usage, recommendation: generateReplenishmentRecommendation("P-1", 6, usage) };
}

describe("the escape clause, closed by arithmetic", () => {
  it("a zero reorder point and an absent usage history are the same condition", () => {
    for (const pattern of [[], [0], [0, 0, 0], [1], [5, 5], [1, 0, 2], [3, 2, 4]]) {
      const { usage, recommendation } = healthFor(pattern);
      expect(
        recommendation.reorderPoint === 0,
        `pattern ${JSON.stringify(pattern)} — reorderPoint=${recommendation.reorderPoint} totalConsumed=${usage.totalConsumed}`,
      ).toBe(usage.totalConsumed === 0);
    }
  });

  it("the no-usage case really does produce the zero the ruling is about", () => {
    // The premise, proved rather than assumed. Without this the rule below could be guarding a case
    // that never occurs.
    const { usage, recommendation } = healthFor([]);
    expect(usage.totalConsumed).toBe(0);
    expect(recommendation.reorderPoint).toBe(0);
  });
});

describe("what the record shows", () => {
  it("no usage history — Not established, and no number at all", () => {
    const shown = partReorderPointDisplay(healthFor([]));
    expect(shown.established).toBe(false);
    expect(shown.value).toBeNull();
    expect(shown.absence).toBe("Not established");
  });

  it("real usage history — the existing derived number, only rounded", () => {
    const health = healthFor([3, 2, 4]);
    const shown = partReorderPointDisplay(health);
    expect(shown.established).toBe(true);
    expect(shown.value).toBe(Math.ceil(health.recommendation.reorderPoint));
    expect(shown.absence).toBeNull();
    // NO NEW CALCULATION. The displayed figure is the engine's own, rounded for display and not
    // otherwise touched — the ruling forbids inventing a reorder calculation as part of the fix.
    expect(shown.value).toBeGreaterThan(0);
  });

  it("withholds a NON-zero number too when the input is absent", () => {
    // Not a case today's engine can produce, and that is the point: the rule keys on the INPUT being
    // absent rather than on the output happening to be zero, so it stays correct if the derivation
    // ever grows a floor or a default.
    const shown = partReorderPointDisplay({
      usage: { totalConsumed: 0, avgDailyUsage: 0 },
      recommendation: { reorderPoint: 5 },
    });
    expect(shown.established).toBe(false);
  });

  it("a malformed or missing health object is Not established, never a number", () => {
    for (const bad of [
      undefined,
      null,
      {},
      { usage: { totalConsumed: 4 } },
      { usage: { totalConsumed: 4 }, recommendation: { reorderPoint: NaN } },
      { usage: { totalConsumed: 4 }, recommendation: { reorderPoint: Infinity } },
      { usage: { totalConsumed: 4 }, recommendation: { reorderPoint: "3" } },
    ]) {
      const shown = partReorderPointDisplay(bad);
      expect(shown.established, JSON.stringify(bad)).toBe(false);
      expect(shown.value).toBeNull();
    }
  });
});
