// THE TOUCH FLOOR ON THE NORTH STAR WORK ORDER, AS A CONTRACT.
//
// jsdom does not do layout, so a rendered height cannot be measured here — the live measurement is
// the deployed sweep, and its numbers are in the PR. What this suite defends is the RULE that
// produces those numbers, because the rule is what regressed: the floor existed, and a
// `@media (min-width: 768px) { min-height: 0 }` relaxed it away on the reasoning that a wide screen
// is a pointer screen. 768 and 1024 are tablet widths. A tablet is a thumb.
//
// So these assertions are about the CSS contract and the DOM semantics that survive alongside it:
//   * the floor is the default, not something a width has to opt into
//   * density is granted only to a screen that is both wide AND pointer-driven
//   * there is no `767.98px` cliff — a compliance boundary one pixel under the commonest tablet
//   * the chips stay real, reachable, semantically-labelled buttons while meeting it
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import LifecycleBand from "../src/shared/ui/LifecycleBand.jsx";
import { workOrderSpine, workOrderStageDetail } from "../src/domain/workOrderNorthStar.js";

// process.cwd(), not import.meta.url: vitest transforms this module and import.meta.url is not a
// file: URL by the time it runs. The runner always starts in field-ops-app-vite.
const CSS = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
afterEach(cleanup);

/** The declaration block for a selector, as written. */
function ruleFor(selector) {
  const at = CSS.indexOf(selector);
  if (at < 0) return null;
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

describe("the touch floor is the default, and density is the exception", () => {
  it("THE LIFECYCLE CHIP CARRIES THE 44px FLOOR UNCONDITIONALLY", () => {
    const rule = ruleFor(".ns-chip {");
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/min-height:\s*44px/);
  });

  it("THE RECORD HEADER'S BUTTONS CARRY IT TOO -- one height across the cluster", () => {
    // Raising only the disabled placeholders would leave 44px next to 40px in the same row.
    const at = CSS.indexOf(".ns-identity__actions .fo-button,");
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, at + 400);
    expect(block).toMatch(/\.ns-btn-pending/);
    expect(block).toMatch(/min-height:\s*44px/);
  });

  it("DENSITY REQUIRES A WIDE SCREEN *AND* A FINE POINTER -- never width alone", () => {
    const relaxations = [...CSS.matchAll(/@media[^{]*\{\s*[^}]*\.ns-chip\s*\{[^}]*min-height:\s*0/g)]
      .map((m) => m[0]);
    expect(relaxations.length).toBeGreaterThan(0);
    for (const r of relaxations) {
      expect(r, `a chip relaxation must require a pointer, not just a width: ${r}`).toMatch(/pointer:\s*fine/);
      expect(r).toMatch(/hover:\s*hover/);
    }
  });

  it("NO 767.98px COMPLIANCE CLIFF -- nothing turns the floor off just above a tablet width", () => {
    // The old shape: `@media (min-width: 768px) { .ns-chip { min-height: 0 } }` and its mirror
    // `@media (max-width: 767.98px) { .ns-btn-pending { min-height: 44px } }`. Either one makes 768
    // exactly non-compliant while 767 is fine, which no user could perceive as a reason.
    expect(CSS).not.toMatch(/@media \(min-width: 768px\)\s*\{\s*\.ns-chip\s*\{\s*min-height:\s*0/);
    expect(CSS).not.toMatch(/@media \(max-width: 767\.98px\)\s*\{\s*\.ns-btn-pending/);
  });

  it("the reduced-motion rule is untouched -- the pulse still stops when asked", () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ns-chip__pulse\s*\{\s*animation:\s*none/);
  });
});

describe("meeting the floor did not cost the chip its semantics", () => {
  const bandFor = (workOrder) => {
    const spine = workOrderSpine(workOrder.status);
    return render(
      <LifecycleBand
        steps={spine.steps}
        terminal={spine.terminal}
        detailFor={(k) => workOrderStageDetail(workOrder, k, () => "Aug 21, 3:12 PM")}
        ariaLabel="Work order lifecycle"
      />,
    );
  };

  it("every stage is still a real button, enabled and keyboard-reachable", () => {
    const { container } = bandFor({ status: "DISPATCHED", dispatchedAt: {} });
    const chips = [...container.querySelectorAll(".ns-chip")];
    expect(chips).toHaveLength(6);
    for (const chip of chips) {
      expect(chip.tagName).toBe("BUTTON");
      expect(chip.hasAttribute("disabled")).toBe(false);
      expect(chip.getAttribute("aria-expanded")).toBeTruthy();
    }
  });

  it("aria-current still marks the stage the record is on", () => {
    const { container } = bandFor({ status: "WORK_IN_PROGRESS" });
    expect(container.querySelector(".ns-chip--current").getAttribute("aria-current")).toBe("step");
  });

  it("aria-expanded still tracks which stage is open", () => {
    const { container } = bandFor({ status: "DISPATCHED", dispatchedAt: {} });
    const closed = container.querySelectorAll('.ns-chip[aria-expanded="false"]');
    const open = container.querySelectorAll('.ns-chip[aria-expanded="true"]');
    expect(open).toHaveLength(1);
    expect(closed.length).toBe(5);
    fireEvent.click([...closed][0]);
    expect(container.querySelectorAll('.ns-chip[aria-expanded="true"]')).toHaveLength(1);
  });

  it("the three states remain distinguishable, and completion still carries a glyph", () => {
    const { container } = bandFor({ status: "DISPATCHED", dispatchedAt: {} });
    expect(container.querySelectorAll(".ns-chip--complete").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".ns-chip--current")).toHaveLength(1);
    expect(container.querySelectorAll(".ns-chip--future").length).toBeGreaterThan(0);
    for (const done of container.querySelectorAll(".ns-chip--complete")) {
      expect(done.textContent).toContain("✓");
    }
  });

  it("the chevron notch survives -- the band is still the concept's shape, not a row of pills", () => {
    const base = ruleFor(".ns-chip {");
    expect(base).toMatch(/clip-path:\s*polygon/);
    expect(ruleFor(".ns-chip--first {")).toMatch(/clip-path:\s*polygon/);
    expect(ruleFor(".ns-chip--last {")).toMatch(/clip-path:\s*polygon/);
  });

  it("a terminal outcome stays non-interactive -- a cancelled record reached no further stage", () => {
    const { container } = bandFor({ status: "CANCELLED" });
    const terminal = container.querySelector(".ns-chip--terminal");
    expect(terminal.tagName).not.toBe("BUTTON");
  });
});
