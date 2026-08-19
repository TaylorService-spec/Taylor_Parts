// Design-system foundation (PR 1) -- RENDER tests for the new tokens/primitives
// package: Icon, Button (variant + state matrix), IconButton (accessible-name
// contract), StatusIndicator (icon+text+colour), CompactMetric, PageHeader,
// SectionHeader, and the additive `icon`/`withIcon` props on the pre-existing
// LoadingState/EmptyState/FailureState. Nothing here asserts on business logic
// or capability enforcement -- these are pure presentational primitives.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Check } from "lucide-react";
import Icon from "../src/shared/ui/Icon.jsx";
import Button from "../src/shared/ui/primitives/Button.jsx";
import IconButton from "../src/shared/ui/primitives/IconButton.jsx";
import StatusIndicator from "../src/shared/ui/primitives/StatusIndicator.jsx";
import CompactMetric from "../src/shared/ui/primitives/CompactMetric.jsx";
import PageHeader from "../src/shared/ui/primitives/PageHeader.jsx";
import SectionHeader from "../src/shared/ui/primitives/SectionHeader.jsx";
import LoadingState from "../src/shared/ui/LoadingState.jsx";
import EmptyState from "../src/shared/ui/EmptyState.jsx";
import FailureState from "../src/shared/ui/FailureState.jsx";

afterEach(cleanup);

describe("Icon", () => {
  it("is decorative (aria-hidden) by default and sized via the scale token", () => {
    const { container } = render(<Icon icon={Check} size="nav" />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("width")).toBe("var(--icon-size-nav)");
  });
  it("renders nothing when given no icon component", () => {
    const { container } = render(<Icon icon={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Button", () => {
  it("renders each variant with its modifier class", () => {
    for (const variant of ["primary", "secondary", "tertiary", "destructive", "icon"]) {
      const { container, unmount } = render(<Button variant={variant}>Go</Button>);
      expect(container.querySelector(`.fo-button--${variant}`)).toBeTruthy();
      unmount();
    }
  });

  it("loading state sets aria-busy + disables the button (no duplicate submission) without hiding the label from the DOM (width-stable)", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    // The label text stays in the DOM (visibility:hidden, not display:none / removed)
    // so the button's rendered width never changes between idle and loading.
    expect(screen.getByText("Save")).toBeTruthy();
  });

  it("protected variant renders a lock icon, is disabled, and explains why via a visible, linked reason", () => {
    render(<Button variant="protected" reason="Requires dispatcher role" id="dispatch-btn">Dispatch</Button>);
    const btn = screen.getByRole("button", { name: /Dispatch/ });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const reasonId = btn.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reasonEl = document.getElementById(reasonId);
    expect(reasonEl.textContent).toBe("Requires dispatcher role");
  });

  it("never grants capability: protected stays aria-disabled regardless of caller props", () => {
    render(<Button variant="protected" reason="No access" disabled={false}>Do it</Button>);
    expect(screen.getByRole("button", { name: /Do it/ }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("IconButton", () => {
  it("exposes the label as the accessible name AND as visible tooltip text", () => {
    render(<IconButton icon={Check} label="Mark complete" />);
    const btn = screen.getByRole("button", { name: "Mark complete" });
    expect(btn).toBeTruthy();
    expect(screen.getByText("Mark complete")).toBeTruthy(); // visible tooltip node, not just aria-label
  });
});

describe("StatusIndicator", () => {
  it("pairs an icon with tone-coloured text (never colour alone)", () => {
    const { container } = render(<StatusIndicator tone="critical" label="Sync failed" />);
    expect(container.querySelector(".fo-status-indicator--critical")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Sync failed")).toBeTruthy();
  });
  it("falls back to neutral for an unknown tone", () => {
    const { container } = render(<StatusIndicator tone="not-a-tone" label="x" />);
    expect(container.querySelector(".fo-status-indicator--neutral")).toBeTruthy();
  });
});

describe("CompactMetric", () => {
  it("renders a tabular-numerals value and its label", () => {
    const { container } = render(<CompactMetric value={42} label="Open Work Orders" />);
    expect(container.querySelector(".fo-tabular-nums").textContent).toBe("42");
    expect(screen.getByText("Open Work Orders")).toBeTruthy();
  });
});

describe("PageHeader / SectionHeader", () => {
  it("PageHeader renders an h1 title and an actions slot", () => {
    render(<PageHeader title="Work Orders" actions={<button>New</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Work Orders" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });
  it("SectionHeader renders a heading at the requested level", () => {
    render(<SectionHeader title="Notes" level={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "Notes" })).toBeTruthy();
  });
});

// SUPERSEDED DEFAULTS. The foundation PR introduced `icon`/`withIcon` as OPT-IN
// specifically so that merging tokens and primitives changed no existing screen's
// output -- and these assertions pinned that promise. The migration PR that follows
// it is the point at which consumers are meant to pick the new composition up, and
// it flipped these three defaults ON so that all 36 existing call sites gain
// icon + heading + message without each one being edited.
//
// The assertions are INVERTED rather than deleted, so the new default stays an
// asserted decision: each state still proves it renders an icon by default AND that
// a caller can still suppress it per instance. A future change back to opt-in would
// have to be a choice someone makes here, not a drift nobody notices.
describe("LoadingState / EmptyState / FailureState -- icon composition", () => {
  it("LoadingState shows a spinning icon by default, and withIcon={false} opts out", () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelector("svg.fo-icon--spin")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
    cleanup();
    const plain = render(<LoadingState withIcon={false} />);
    expect(plain.container.querySelector("svg")).toBeNull();
  });
  it("EmptyState shows a variant-appropriate icon by default, and icon={null} opts out", () => {
    const { container } = render(<EmptyState title="No results" />);
    expect(container.querySelector("svg")).toBeTruthy();
    cleanup();
    const plain = render(<EmptyState title="No results" icon={null} />);
    expect(plain.container.querySelector("svg")).toBeNull();
  });
  it("FailureState shows an icon by default, keeps role=alert, and icon={null} opts out", () => {
    const { container } = render(<FailureState message="Could not load" />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    cleanup();
    const plain = render(<FailureState message="Could not load" icon={null} />);
    expect(plain.container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
