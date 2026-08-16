// Contextual-help slice -- render tests for EmptyState's `guidance` slot.
//
// The load-bearing rule is the variant scope, and it is enforced in the component
// rather than at the ~30 call sites on purpose: a "filtered" empty means the user
// already HAS records and merely over-filtered, so re-explaining what the entity is
// at that moment is noise -- and it would reappear on every filter change. Callers
// are therefore free to pass `guidance` unconditionally; only "database" renders it.
// Without this test, a well-meaning refactor could quietly move the decision back
// out to callers and the noise would return one screen at a time.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import EmptyState from "../src/shared/ui/EmptyState.jsx";

afterEach(cleanup);

const GUIDANCE = "A work order is the customer-facing service record for one job.";

describe("EmptyState guidance slot", () => {
  it("renders guidance on the database variant (the first-run empty)", () => {
    render(<EmptyState variant="database" title="No work orders yet" guidance={GUIDANCE} />);
    const el = screen.getByText(GUIDANCE);
    expect(el.className).toContain("fo-state-guidance");
    expect(el.hasAttribute("data-state-guidance")).toBe(true);
  });

  it("suppresses guidance on the filtered variant even when the caller passes it", () => {
    render(<EmptyState variant="filtered" message="No matches." guidance={GUIDANCE} />);
    expect(screen.queryByText(GUIDANCE)).toBeNull();
    expect(document.querySelector("[data-state-guidance]")).toBeNull();
  });

  it("omits the guidance element entirely when no guidance is supplied", () => {
    render(<EmptyState variant="database" title="No work orders yet" message="None yet." />);
    expect(document.querySelector(".fo-state-guidance")).toBeNull();
  });

  it("keeps guidance distinct from the message -- both render, message stays muted", () => {
    render(<EmptyState variant="database" message="None yet." guidance={GUIDANCE} />);
    const message = screen.getByText("None yet.");
    expect(message.className).toContain("fo-muted");
    expect(message.className).toContain("fo-state-message");
    // Guidance is deliberately NOT fo-muted: it is the one line a first-run user is
    // meant to read, so it must not be de-emphasised below the message above it.
    expect(screen.getByText(GUIDANCE).className).not.toContain("fo-muted");
  });

  it("does not add alert semantics -- an empty collection is not an error", () => {
    const { container } = render(<EmptyState variant="database" guidance={GUIDANCE} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
