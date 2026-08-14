// Wave 4 — Peer Operational Card (shared/ui/OperationalCard.jsx) coverage: every documented
// state/interaction, plus the nested-interactive-element guard the Owner explicitly required.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import OperationalCard, { OperationalCardGrid } from "../src/shared/ui/OperationalCard.jsx";

afterEach(cleanup);

// Fails if ANY interactive element (button/a/[role=button]/[role=link]) contains another
// interactive element as a descendant — the concrete defect the "no nested interactive
// elements" requirement guards against, checked structurally rather than by convention.
function assertNoNestedInteractive(container) {
  const interactiveSelector = "button, a, [role='button'], [role='link']";
  const all = [...container.querySelectorAll(interactiveSelector)];
  for (const el of all) {
    const nested = [...el.querySelectorAll(interactiveSelector)];
    expect(nested, `${el.tagName} nests interactive element(s): ${nested.map((n) => n.tagName).join(", ")}`).toEqual([]);
  }
}

describe("OperationalCard — identity, status, metadata, metric", () => {
  it("renders title, a StatusPill for status, subtitle, metadata rows, and a metric", () => {
    const { container } = render(
      <OperationalCard
        title="TRK-204"
        status={{ tone: "positive", label: "ACTIVE" }}
        subtitle="Alex Rivera · North Annex"
        metric={{ label: "Value", value: "$48,250" }}
        metadata={[
          { key: "serialized", label: "Serialized", value: 4 },
          { key: "parts", label: "Parts", value: 12 },
        ]}
      />
    );
    expect(screen.getByText("TRK-204")).toBeTruthy();
    const pill = screen.getByText("ACTIVE");
    expect(pill.className).toContain("fo-status-pill");
    expect(pill.className).toContain("fo-status-pill--positive");
    expect(screen.getByText("Alex Rivera · North Annex")).toBeTruthy();
    expect(screen.getByText("$48,250")).toBeTruthy();
    expect(screen.getByText("Serialized")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    assertNoNestedInteractive(container);
  });

  it("a metadata value of null/undefined renders an em dash, never a blank cell", () => {
    render(<OperationalCard title="X" metadata={[{ key: "v", label: "Value", value: null }]} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("attention renders its own region and marks the card with the attention modifier (not a side-tab border)", () => {
    const { container } = render(<OperationalCard title="X" attention="Discrepancy found" />);
    expect(screen.getByText("Discrepancy found")).toBeTruthy();
    const card = container.querySelector(".fo-op-card");
    expect(card.className).toContain("fo-op-card--attention");
  });

  it("footer renders a trailing note", () => {
    render(<OperationalCard title="X" footer="Reconciled 2026-08-01" />);
    expect(screen.getByText("Reconciled 2026-08-01")).toBeTruthy();
  });
});

describe("OperationalCard — selectable mode (onSelect)", () => {
  it("renders the WHOLE card as one button and fires onSelect on click", () => {
    const onSelect = vi.fn();
    const { container } = render(<OperationalCard title="TRK-204" onSelect={onSelect} />);
    const btn = screen.getByRole("button", { name: /TRK-204/ });
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
    assertNoNestedInteractive(container);
  });

  it("selected reflects via aria-pressed and the selected modifier class", () => {
    const { rerender, container } = render(<OperationalCard title="X" onSelect={() => {}} selected={false} />);
    let btn = container.querySelector("button.fo-op-card");
    expect(btn.getAttribute("aria-pressed")).toBeNull();
    rerender(<OperationalCard title="X" onSelect={() => {}} selected />);
    btn = container.querySelector("button.fo-op-card");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("fo-op-card--selected");
  });

  it("disabled state suppresses the click and sets the native disabled attribute", () => {
    const onSelect = vi.fn();
    const { container } = render(<OperationalCard title="X" onSelect={onSelect} state="disabled" />);
    const btn = container.querySelector("button.fo-op-card");
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("passing BOTH onSelect and actions drops actions rather than nesting a button in a button", () => {
    const { container } = render(
      <OperationalCard
        title="X"
        onSelect={() => {}}
        actions={<button type="button">Secondary</button>}
      />
    );
    expect(container.querySelector(".fo-op-card__actions")).toBeNull();
    expect(screen.queryByText("Secondary")).toBeNull();
    assertNoNestedInteractive(container);
  });
});

describe("OperationalCard — static mode (actions)", () => {
  it("renders a non-interactive <article> with actions OUTSIDE any interactive wrapper", () => {
    const onClick = vi.fn();
    const { container } = render(
      <OperationalCard
        title="Part 9001"
        actions={<button type="button" onClick={onClick}>Reorder</button>}
      />
    );
    const article = container.querySelector("article.fo-op-card");
    expect(article).toBeTruthy();
    const actionBtn = screen.getByRole("button", { name: "Reorder" });
    fireEvent.click(actionBtn);
    expect(onClick).toHaveBeenCalledTimes(1);
    assertNoNestedInteractive(container);
  });

  it("static mode has no whole-card click handler — only the explicit action is interactive", () => {
    const { container } = render(<OperationalCard title="X" actions={<button type="button">Go</button>} />);
    const article = container.querySelector("article.fo-op-card");
    expect(article.tagName).toBe("ARTICLE");
    expect(container.querySelectorAll("button").length).toBe(1); // only the action button, never the card itself
  });

  // A disabled/loading/unavailable card must not leave its own action buttons live: disabled
  // means nothing on the card should be executable, and loading/unavailable have no confirmed
  // object to act on in the first place. Actions render ONLY in the "ready" state.
  it.each(["disabled", "loading", "unavailable"])("state=%s suppresses actions entirely", (state) => {
    const onClick = vi.fn();
    const { container } = render(
      <OperationalCard
        title="Part 9001"
        state={state}
        actions={<button type="button" onClick={onClick}>Reorder</button>}
      />
    );
    expect(container.querySelector(".fo-op-card__actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reorder" })).toBeNull();
    expect(container.querySelectorAll("button").length).toBe(0); // no action button present to click at all
  });
});

describe("OperationalCard — loading / unavailable states", () => {
  it("loading replaces the body with an honest placeholder, never stale/fabricated content", () => {
    render(<OperationalCard title="Should not render" state="loading" loadingMessage="Loading truck…" />);
    expect(screen.getByText("Loading truck…")).toBeTruthy();
    expect(screen.queryByText("Should not render")).toBeNull();
  });

  it("unavailable replaces the body with an honest placeholder", () => {
    render(<OperationalCard title="Should not render" state="unavailable" unavailableMessage="Not connected" />);
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.queryByText("Should not render")).toBeNull();
  });

  it("an unrecognized state string falls back to ready (never throws, never silently disables)", () => {
    render(<OperationalCard title="Visible" state="not-a-real-state" />);
    expect(screen.getByText("Visible")).toBeTruthy();
  });
});

describe("OperationalCard — density", () => {
  it("density sets data-density on the card element itself in both interaction modes", () => {
    const { container: selectableContainer } = render(<OperationalCard title="X" onSelect={() => {}} density="field" />);
    expect(selectableContainer.querySelector("button.fo-op-card").getAttribute("data-density")).toBe("field");

    const { container: staticContainer } = render(<OperationalCard title="X" density="compact" />);
    expect(staticContainer.querySelector("article.fo-op-card").getAttribute("data-density")).toBe("compact");
  });
});

describe("OperationalCard — root-prop passthrough", () => {
  it("selectable (button) mode forwards unrecognized props (e.g. a test-hook data attribute) to the root button", () => {
    const { container } = render(
      <OperationalCard title="Air Handler 2" onSelect={() => {}} data-equipment-status="ACTIVE" aria-label="Open Air Handler 2" />
    );
    const btn = container.querySelector("button.fo-op-card");
    expect(btn.getAttribute("data-equipment-status")).toBe("ACTIVE");
    expect(btn.getAttribute("aria-label")).toBe("Open Air Handler 2");
  });

  it("static (article) mode forwards unrecognized props to the root article", () => {
    const { container } = render(
      <OperationalCard title="Part 9001" data-equipment-status="ACTIVE" aria-label="Part 9001 card" />
    );
    const article = container.querySelector("article.fo-op-card");
    expect(article.getAttribute("data-equipment-status")).toBe("ACTIVE");
    expect(article.getAttribute("aria-label")).toBe("Part 9001 card");
  });

  it("passthrough cannot override the component's own controlled attributes (className/disabled/aria-busy)", () => {
    const { container } = render(
      <OperationalCard title="X" onSelect={() => {}} state="disabled" className="caller-class" disabled={false} aria-busy="false" />
    );
    const btn = container.querySelector("button.fo-op-card");
    expect(btn.className).toContain("fo-op-card--disabled"); // component-controlled class survives alongside caller-class
    expect(btn.className).toContain("caller-class");
    expect(btn.disabled).toBe(true); // component's own disabled state wins, not the caller's stray override
  });
});

describe("OperationalCardGrid", () => {
  it("renders a responsive list wrapper around its children", () => {
    const { container } = render(
      <OperationalCardGrid aria-label="Fleet">
        <li>one</li>
        <li>two</li>
      </OperationalCardGrid>
    );
    const grid = container.querySelector(".fo-op-card-grid");
    expect(grid).toBeTruthy();
    expect(grid.tagName).toBe("UL");
    expect(grid.getAttribute("aria-label")).toBe("Fleet");
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
  });
});
