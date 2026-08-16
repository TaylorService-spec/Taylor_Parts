// Sandbox-fidelity Part 2 -- regression pinning the fix for demo/heroConfig contamination on the
// legacy Dispatch Queue surface (src/modules/dispatch/Dispatch.jsx).
//
// Before this fix, Dispatch.jsx imported demo/heroConfig.js and used it to: (1) sort a job whose
// woNumber matched the hardcoded "Beacon Manufacturing" hero customer to the top of the queue,
// (2) badge that job "Active Demo Job" via a `fo-chip-hero` chip, and (3) pre-select a hardcoded
// "Alex Rivera" hero technician in the assign <select>'s defaultValue whenever that job/tech pair
// appeared. None of that is a governed field -- it's a demo-story overlay that could silently alter
// how a REAL, production-shaped record renders and defaults an assignment decision just because its
// name happened to match a hardcoded string.
//
// This test proves, structurally:
//   1. Dispatch.jsx no longer imports demo/heroConfig.js at all (grep on source -- catches the
//      contamination coming back even if the render-level assertions below were satisfied by
//      coincidence).
//   2. A work order whose woNumber/customer matches the OLD hero identifiers ("Beacon Manufacturing")
//      renders with NO "Active Demo Job" badge and is not reordered ahead of a normal job.
//   3. A technician whose name matches the OLD hero identifier ("Alex Rivera") is not pre-selected in
//      the assign dropdown -- the select's defaultValue stays the neutral empty option regardless of
//      technician name.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));

import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
import Dispatch from "../src/modules/dispatch/Dispatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Dispatch -- no demo/heroConfig contamination in normal runtime", () => {
  it("does not import demo/heroConfig.js from source (structural: contamination cannot silently return)", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../src/modules/dispatch/Dispatch.jsx"),
      "utf8"
    );
    // Strip // line comments before asserting -- this test file's own explanatory header intentionally
    // names heroConfig.js in prose, and that must not make the assertion trivially pass/fail on comment
    // text. What actually matters is the executable source: no import statement, no call site.
    const codeOnly = source
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(codeOnly).not.toMatch(/heroConfig/i);
    expect(codeOnly).not.toMatch(/isHeroActiveJob|isHeroTechnician|isHeroCompletedJob/);
  });

  it("renders a job matching the old hero customer name with no 'Active Demo Job' badge and no reordering", () => {
    const normalJob = {
      id: "wo-normal",
      woNumber: "Ordinary Customer",
      status: "SCHEDULED",
      description: "Routine PM",
    };
    const heroNamedJob = {
      id: "wo-hero-named",
      woNumber: "Beacon Manufacturing", // the OLD hero HERO_IDS.activeJob value
      status: "SCHEDULED",
      description: "Looks like the old hero job by name only",
    };
    useWorkOrders.mockReturnValue({ data: [normalJob, heroNamedJob], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });

    render(<Dispatch />);

    // No demo badge anywhere on the page.
    expect(screen.queryByText(/active demo job/i)).toBeNull();

    // Original order preserved -- the hero-named job is not pinned to the top. Both job cards render
    // in the order the (mocked) data arrived: normalJob first, heroNamedJob second.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Ordinary Customer", "Beacon Manufacturing"]);
  });

  it("does not pre-select a technician named 'Alex Rivera' (old hero technician) in the assign dropdown", () => {
    const job = {
      id: "wo-1",
      woNumber: "WO-100",
      status: "SCHEDULED",
      description: "Needs a tech",
    };
    const heroNamedTech = { id: "tech-1", name: "Alex Rivera", status: "available" };
    useWorkOrders.mockReturnValue({ data: [job], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [heroNamedTech], loading: false, error: null });

    render(<Dispatch />);

    const select = screen.getByRole("combobox");
    // Neutral default -- the disabled placeholder option, never the hero-named technician's id.
    expect(select.value).toBe("");
  });
});
