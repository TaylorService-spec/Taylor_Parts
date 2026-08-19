// LoadingEmptyState -- M25 regression coverage.
//
// The primitive originally branched on only `loading`/`isEmpty`, so a permission-denied
// or read-error had no honest place to go: every caller was forced to coerce it into
// `isEmpty`, which reports the failure as "nothing here" and (because the empty branch
// carries no role="alert") drops it out of the accessibility tree's alert channel
// entirely. `failed` is a third, explicit branch. These tests assert it renders visibly
// distinct from -- and with different accessibility semantics than -- a genuine empty
// result, mirroring the "four empties stay four" contract MetadataListGrid.jsx's own
// tests already enforce for its DENIED/UNAVAILABLE states.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadingEmptyState from "../src/shared/ui/LoadingEmptyState.jsx";

describe("LoadingEmptyState", () => {
  it("loading takes priority and renders the loading text", () => {
    render(
      <LoadingEmptyState loading isEmpty={false} loadingText="Loading things..." emptyText="Nothing here.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(screen.getByText("Loading things...")).toBeTruthy();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("a genuine empty result renders without alert semantics", () => {
    const { container } = render(
      <LoadingEmptyState loading={false} isEmpty loadingText="Loading..." emptyText="No inventory actions logged yet.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(screen.getByText("No inventory actions logged yet.")).toBeTruthy();
    // An empty result is not an error -- it must never carry role="alert".
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("a failed read renders through FailureState with role=\"alert\", distinct from empty", () => {
    const { container } = render(
      <LoadingEmptyState
        loading={false}
        isEmpty
        failed
        loadingText="Loading..."
        emptyText="No inventory actions logged yet."
        failedText="Unable to load the inventory action log right now. Try again shortly."
      >
        <p>content</p>
      </LoadingEmptyState>
    );
    // The failure message renders, not the empty message -- failed wins even when a
    // caller (defensively, or by accident) also sets isEmpty.
    expect(screen.getByText("Unable to load the inventory action log right now. Try again shortly.")).toBeTruthy();
    expect(screen.queryByText("No inventory actions logged yet.")).toBeNull();
    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl).toBeTruthy();
    expect(alertEl.textContent).toContain("Unable to load the inventory action log right now.");
  });

  it("failed is checked before isEmpty, so it never silently falls through to the empty box", () => {
    const { container } = render(
      <LoadingEmptyState loading={false} isEmpty={false} failed loadingText="Loading..." failedText="Access denied.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("falls back to emptyText for failedText when no dedicated failure copy is supplied", () => {
    const { container } = render(
      <LoadingEmptyState loading={false} isEmpty failed loadingText="Loading..." emptyText="Could not be loaded (access denied or a read error). Try again.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "Could not be loaded (access denied or a read error). Try again."
    );
  });

  it("READY renders children when not loading, not empty, and not failed", () => {
    render(
      <LoadingEmptyState loading={false} isEmpty={false} failed={false} loadingText="Loading..." emptyText="Empty.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("existing two-state callers (no failed prop passed) are unaffected", () => {
    // Every pre-M25 call site only ever passed loading/isEmpty -- `failed` must default
    // to a falsy no-op so none of them silently change behavior.
    const { rerender, container } = render(
      <LoadingEmptyState loading isEmpty={false} loadingText="Loading..." emptyText="Empty.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(screen.getByText("Loading...")).toBeTruthy();

    rerender(
      <LoadingEmptyState loading={false} isEmpty loadingText="Loading..." emptyText="Empty.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(screen.getByText("Empty.")).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    rerender(
      <LoadingEmptyState loading={false} isEmpty={false} loadingText="Loading..." emptyText="Empty.">
        <p>content</p>
      </LoadingEmptyState>
    );
    expect(screen.getByText("content")).toBeTruthy();
  });
});
