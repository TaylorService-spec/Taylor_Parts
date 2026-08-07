// Wave-0 composition foundation — RENDER tests (vitest + jsdom) for the P1 primitives: the Operating
// Workspace Shell (regions + density + responsive split), Context Band (strip not card), Action Rail
// (hierarchy slots), the unified Semantic Status Pill (tone-driven), and the tone layer.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import WorkspaceShell from "../src/shared/ui/WorkspaceShell.jsx";
import ContextBand from "../src/shared/ui/ContextBand.jsx";
import ActionRail from "../src/shared/ui/ActionRail.jsx";
import StatusPill from "../src/shared/ui/StatusPill.jsx";
import { toneClass, isTone, TONES } from "../src/shared/ui/tone.js";

afterEach(cleanup);

describe("tone layer", () => {
  it("maps known tones and falls back to neutral for unknown (never throws)", () => {
    expect(TONES).toContain("attention");
    expect(isTone("attention")).toBe(true);
    expect(isTone("nope")).toBe(false);
    expect(toneClass("attention")).toBe("fo-tone--attention");
    expect(toneClass("nope")).toBe("fo-tone--neutral"); // safe fallback
  });
});

describe("StatusPill (unified, tone-driven)", () => {
  it("renders a tone pill with its label", () => {
    render(<StatusPill tone="attention" label="Needs attention" />);
    const el = screen.getByText("Needs attention");
    expect(el.className).toContain("fo-status-pill");
    expect(el.className).toContain("fo-status-pill--attention");
  });
  it("asText renders toned text, not a pill (avoid badge overload)", () => {
    render(<StatusPill tone="positive" asText>Ready</StatusPill>);
    const el = screen.getByText("Ready");
    expect(el.className).toContain("fo-status-text");
    expect(el.className).toContain("fo-tone-text--positive");
    expect(el.className).not.toContain("fo-status-pill");
  });
});

describe("ContextBand", () => {
  it("renders label/value pairs + an action; skips items without a label; '—' for empty values", () => {
    render(
      <ContextBand
        items={[{ label: "Customer", value: "Northgate" }, { label: "Site", value: null }, { value: "orphan" }]}
        action={<button>Open</button>}
      />
    );
    expect(screen.getByText("Customer")).toBeTruthy();
    expect(screen.getByText("Northgate")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy(); // empty value shows an em dash
    expect(screen.queryByText("orphan")).toBeNull(); // no label -> skipped
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });
});

describe("ActionRail", () => {
  it("places primary + secondary in the end slot and start content in the start slot", () => {
    const { container } = render(
      <ActionRail start={<span>ctx</span>} secondary={<button>Cancel</button>} primary={<button className="fo-btn-primary">Save</button>} />
    );
    expect(container.querySelector(".fo-action-rail__start")).toBeTruthy();
    expect(container.querySelector(".fo-action-rail__end")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("fo-btn-primary");
  });
});

describe("WorkspaceShell (Operating Workspace Shell)", () => {
  it("renders regions, resolves .fo-workspace, sets density, and splits when supporting is present", () => {
    const { container } = render(
      <WorkspaceShell
        title="Service Operations"
        density="field"
        actions={<button>New</button>}
        context={<ContextBand items={[{ label: "As of", value: "9:00" }]} />}
        attention={<div>2 need attention</div>}
        supporting={<div>aside</div>}
      >
        <div>work area</div>
      </WorkspaceShell>
    );
    const ws = container.querySelector(".fo-workspace");
    expect(ws).toBeTruthy();
    expect(ws.getAttribute("data-density")).toBe("field"); // job-fit density
    expect(screen.getByText("Service Operations")).toBeTruthy(); // identity via WorkspaceHeader
    expect(container.querySelector(".fo-workspace__attention")).toBeTruthy(); // attention above work
    expect(container.querySelector(".fo-workspace__body--split")).toBeTruthy(); // supporting -> split
    expect(screen.getByText("work area")).toBeTruthy();
    expect(screen.getByText("aside")).toBeTruthy();
  });
  it("omits the split when there is no supporting content (work area is dominant)", () => {
    const { container } = render(<WorkspaceShell title="X"><div>only work</div></WorkspaceShell>);
    expect(container.querySelector(".fo-workspace__body--split")).toBeNull();
  });
});
