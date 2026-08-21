// SCANNER — MOBILE UX REGRESSION PASS (vitest + jsdom + the real stylesheet).
//
// ============================ WHAT THIS FILE IS FOR ============================
//
// The scanner is used one-handed, on a 5" phone, in a cold aisle, by someone wearing a glove. Every
// property that makes that work — a target a thumb can hit, a keyboard that does not zoom the page,
// focus that comes back after every scan, a session that survives a mis-tap — is invisible in review
// and silently removable in a one-line CSS or JSX edit.
//
// So they are asserted. Two kinds of assertion, and the split is deliberate:
//
//   * LAYOUT AND SIZING are read from the REAL stylesheet (src/index.css) as text. jsdom computes no
//     layout, so a rendered-size assertion here would be a fiction that passes forever. Parsing the
//     rules that WOULD apply is honest about what is actually being checked.
//   * BEHAVIOUR is exercised on the REAL mounted components — focus, keyboard, rapid scanning,
//     screen-reader wording, and whether a session survives navigating away.
//
// What this CANNOT prove is stated plainly rather than implied: no rendered pixel is measured, so
// genuine overflow at 360px and true tap accuracy remain a device check. These assertions catch the
// removal of the properties that make those pass, which is the regression that actually happens.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ScanInput from "../src/shared/ui/ScanInput.jsx";
import PutAwayScan from "../src/modules/scan/PutAwayScan.jsx";
import CycleCountScan from "../src/modules/scan/CycleCountScan.jsx";
import ScanWorkspace from "../src/modules/scan/ScanWorkspace.jsx";

afterEach(cleanup);

// The workspace resolves the technician hooks itself (renderSubnavItem cannot call hooks), and
// PartsScanner reads the role from auth. Mocked at module level exactly as test/scanWorkspace.test.jsx
// does, so the composed workspace mounts without reaching Firestore.
vi.mock("../src/hooks/useCurrentTechnician", () => ({
  useCurrentTechnician: () => ({ technicianId: null, loading: false, error: null, retry: () => {} }),
}));
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ role: null, user: { uid: "U1" } }),
}));

// `import.meta.url` is an http URL under vitest, so a file:// read from it throws. Resolve from cwd.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Every declaration block whose selector mentions a scan class. */
function scanRules() {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].trim().split("\n").pop().trim();
    if (/fo-scan/.test(selector)) rules.push({ selector, body: m[2] });
  }
  return rules;
}
const px = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([0-9.]+)px`).exec(body);
  return m ? Number(m[1]) : null;
};

// The iOS floor. Safari zooms the whole page when a focused input's text is under 16px, which on a
// scanning screen means every scan re-frames the layout under the operator's thumb.
const NO_ZOOM_FONT_PX = 16;
// The touch floor everyone agrees on. The scanner deliberately sits above it; this is the line
// below which a control is not usable with a glove on.
const TOUCH_FLOOR_PX = 44;

let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };
const scanInputDeps = { now: advancingClock };

// ═══════════════════════════════════════════ 1. sizing, from the real stylesheet

describe("touch targets and typography", () => {
  it("every scan control that states a height clears the 44px touch floor", () => {
    const undersized = scanRules()
      .map((r) => ({ ...r, h: px(r.body, "min-height") ?? px(r.body, "height") }))
      .filter((r) => r.h !== null && r.h < TOUCH_FLOOR_PX);
    expect(undersized.map((r) => `${r.selector} (${r.h}px)`)).toEqual([]);
  });

  it("the scan input is 16px or larger, so focusing it does not zoom the page on iOS", () => {
    const entry = scanRules().find((r) => /\.fo-scan__entry input/.test(r.selector));
    expect(entry, "the scan input rule must exist to be protected").toBeTruthy();
    expect(px(entry.body, "font-size")).toBeGreaterThanOrEqual(NO_ZOOM_FONT_PX);
  });

  it("the quantity controls are square and large — they are pressed repeatedly, often blind", () => {
    const qty = scanRules().find((r) => /\.fo-scan__qty button/.test(r.selector));
    expect(qty).toBeTruthy();
    expect(px(qty.body, "width")).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    expect(px(qty.body, "height")).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    // Plus and minus must not sit on one vertical axis, where a mis-tap inverts the intent.
    const row = scanRules().find((r) => /\.fo-scan__qty\s*\{|\.fo-scan__qty$/.test(r.selector));
    expect(row?.body).toMatch(/flex-direction\s*:\s*column/.test(row?.body ?? "") ? /^$/ : /display\s*:\s*flex/);
  });
});

// ═══════════════════════════════════════════ 2. narrow viewports

describe("360–430px viewports", () => {
  it("the scan layout is single-column by DEFAULT and widens only at a min-width breakpoint", () => {
    // Mobile-first is what makes the small screen the correct case rather than the leftover one.
    const entry = scanRules().find((r) => /\.fo-scan__entry\s*$/.test(r.selector));
    expect(entry.body).toMatch(/grid-template-columns\s*:\s*1fr/);
    expect(css).toMatch(/@media\s*\(min-width:\s*700px\)[\s\S]{0,400}?\.fo-scan__entry\s*\{[^}]*grid-template-columns/);
  });

  it("no scan rule pins a width wider than the narrowest phone", () => {
    // A single `width: 420px` is all it takes to push the page into horizontal scrolling, which on a
    // scanning screen hides the very field the operator is typing into.
    const NARROWEST = 360;
    const offenders = scanRules()
      .map((r) => ({ ...r, w: px(r.body, "width") ?? px(r.body, "min-width") }))
      .filter((r) => r.w !== null && r.w > NARROWEST);
    expect(offenders.map((r) => `${r.selector} (${r.w}px)`)).toEqual([]);
  });

  it("a long identifier wraps instead of widening the page", () => {
    // Part numbers and serials are unbroken strings; a 40-character serial with nowhere to break is
    // the single most common source of real horizontal overflow on this surface.
    const id = scanRules().find((r) => /\.fo-scan__id/.test(r.selector));
    expect(id, "the scanned-identifier rule must exist").toBeTruthy();
    expect(id.body).toMatch(/overflow-wrap\s*:\s*(anywhere|break-word)|word-break\s*:\s*break-all/);
  });
});

// ═══════════════════════════════════════════ 3. the scanning loop itself

describe("the scanning loop", () => {
  const mountInput = (over = {}) => {
    const onScan = vi.fn();
    render(<ScanInput label="Scan item" placeholder="Scan or type" onScan={onScan} deps={scanInputDeps} {...over} />);
    return onScan;
  };
  const scan = (value) => {
    fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  };

  it("the input is focused on arrival — a scan must land without a tap", () => {
    mountInput();
    expect(document.activeElement).toBe(screen.getByLabelText(/scan item/i));
  });

  it("focus RETURNS after every scan, so the next box can be scanned immediately", () => {
    // The regression this catches is brutal in the aisle: the operator scans, focus is lost to the
    // submit button, and the next three scans go nowhere at all.
    const onScan = mountInput();
    scan("PRT-1001");
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByLabelText(/scan item/i));
  });

  it("ENTER submits — a wedge scanner sends a code and a return key, and never clicks anything", () => {
    const onScan = mountInput();
    const input = screen.getByLabelText(/scan item/i);
    fireEvent.change(input, { target: { value: "PRT-2002" } });
    fireEvent.submit(input.closest("form"));
    expect(onScan).toHaveBeenCalledWith("PRT-2002");
  });

  it("RAPID scanning of DIFFERENT codes registers every one", () => {
    const onScan = mountInput();
    for (const code of ["A-1", "A-2", "A-3", "A-4"]) scan(code);
    expect(onScan.mock.calls.map((c) => c[0])).toEqual(["A-1", "A-2", "A-3", "A-4"]);
  });

  it("the input CLEARS after each scan, so the next code is never appended to the last", () => {
    mountInput();
    scan("PRT-1001");
    expect(screen.getByLabelText(/scan item/i).value).toBe("");
  });

  it("the outcome is announced, not only shown — the sentence a screen reader gets names the value", () => {
    mountInput();
    scan("PRT-1001");
    const live = document.querySelector("[aria-live]");
    expect(live, "a scan outcome must reach a screen-reader user").toBeTruthy();
    expect(live.textContent).toMatch(/PRT-1001/);
  });
});

// ═══════════════════════════════════════════ 4. context stays on screen

describe("persistent context while scanning", () => {
  const client = (over = {}) => ({
    resolveBin: vi.fn().mockResolvedValue({ result: "FOUND", code: "A-14", warehouseId: "WH-1", binId: "bin_WH-1__A-14" }),
    recordPutAway: vi.fn().mockResolvedValue({ outcome: "recorded", binCode: "A-14", partId: "PRT-1001", placementIds: ["plc_1"] }),
    ...over,
  });

  it("the confirmed bin stays visible while items are scanned into it", async () => {
    // On a phone the previous step scrolls off the top. If the destination is not still on screen,
    // an operator four scans deep has no way to check they are stowing into the right rack.
    render(<PutAwayScan deps={{ binClient: client(), session: { warehouseId: "WH-1", partId: "PRT-1001", serialTracked: false }, scanInputDeps }} />);
    fireEvent.change(screen.getByLabelText(/scan bin/i), { target: { value: "A-14" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(screen.queryByLabelText(/scan item/i)).toBeTruthy());
    expect(screen.getAllByText(/A-14/).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════ 5. leaving a workflow mid-session

describe("navigating away from work in progress", () => {
  const client = () => ({
    createCycleCount: vi.fn().mockResolvedValue({ outcome: "applied", cycleCountId: "cc_1", trackingMode: "NONE", status: "COUNTING" }),
    submitCycleCount: vi.fn().mockResolvedValue({ outcome: "applied", status: "SUBMITTED" }),
  });

  async function startCount(onPendingWorkChange) {
    render(<CycleCountScan deps={{ cycleCountClient: client(), scanInputDeps, onPendingWorkChange }} />);
    fireEvent.change(screen.getByLabelText(/part to count/i), { target: { value: "PRT-1001" } });
    fireEvent.change(screen.getByLabelText(/^location$/i), { target: { value: "WH-1" } });
    fireEvent.click(screen.getByRole("button", { name: /start counting/i }));
    await waitFor(() => expect(screen.queryByLabelText(/scan item/i)).toBeTruthy());
  }

  async function scanOnce(value) {
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    });
  }

  it("a count holding scans reports how MUCH work is at stake, not merely that some exists", async () => {
    // THE GUARD. A cycle count is dozens of scans that exist NOWHERE until submitted: not on the
    // server, not in the offline queue, not in storage. Unmounting destroys all of it silently, and
    // the back control is one thumb-width from the scan field.
    //
    // The fix is not to prevent leaving — it is to make leaving a DECISION. That needs a count, not
    // a boolean: "discard 3 scans" is a different sentence from "discard your work".
    const onPendingWorkChange = vi.fn();
    await startCount(onPendingWorkChange);
    for (const code of ["PRT-1001", "PRT-1001", "PRT-1001"]) await scanOnce(code);
    expect(onPendingWorkChange.mock.calls.at(-1)[0]).toBe(3);
  });

  it("unmounting reports ZERO, so a host never guards work that no longer exists", async () => {
    const onPendingWorkChange = vi.fn();
    await startCount(onPendingWorkChange);
    await scanOnce("PRT-1001");
    expect(onPendingWorkChange.mock.calls.at(-1)[0]).toBe(1);
    cleanup();
    expect(onPendingWorkChange.mock.calls.at(-1)[0]).toBe(0);
  });
});

describe("the back control", () => {
  const workspace = () => render(
    <ScanWorkspace deps={{
      hasCapability: (id) => ["inventory.cycleCount.create", "inventory.cycleCount.submit"].includes(id),
      role: null, technicianId: null, assignedWorkOrderCount: 0, receivingReady: false,
      cycleCountDeps: {
        cycleCountClient: {
          createCycleCount: vi.fn().mockResolvedValue({ outcome: "applied", cycleCountId: "cc_1", trackingMode: "NONE", status: "COUNTING" }),
          submitCycleCount: vi.fn().mockResolvedValue({ outcome: "applied", status: "SUBMITTED" }),
        },
        scanInputDeps,
      },
    }} />,
  );

  const back = () => screen.getByRole("button", { name: /all scanning workflows/i });

  async function openCountWithOneScan() {
    workspace();
    fireEvent.click(screen.getByRole("button", { name: /count/i }));
    await waitFor(() => expect(screen.queryByLabelText(/part to count/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/part to count/i), { target: { value: "PRT-1001" } });
    fireEvent.change(screen.getByLabelText(/^location$/i), { target: { value: "WH-1" } });
    fireEvent.click(screen.getByRole("button", { name: /start counting/i }));
    await waitFor(() => expect(screen.queryByLabelText(/scan item/i)).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value: "PRT-1001" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    });
  }

  it("leaves immediately when there is nothing to lose", async () => {
    workspace();
    fireEvent.click(screen.getByRole("button", { name: /count/i }));
    await waitFor(() => expect(screen.queryByLabelText(/part to count/i)).toBeTruthy());
    // An unguarded exit must not cost a second press.
    fireEvent.click(back());
    await waitFor(() => expect(screen.queryByLabelText(/part to count/i)).toBeNull());
  });

  it("with scans pending, the FIRST press states the cost and does not leave", async () => {
    await openCountWithOneScan();
    fireEvent.click(back());
    expect(screen.getByRole("alert").textContent).toMatch(/1 scan has not been submitted/i);
    expect(screen.getByRole("button", { name: /discard and leave/i })).toBeTruthy();
    expect(screen.getByLabelText(/scan item/i)).toBeTruthy();
  });

  it("and the second press discards deliberately", async () => {
    await openCountWithOneScan();
    fireEvent.click(back());
    fireEvent.click(screen.getByRole("button", { name: /discard and leave/i }));
    await waitFor(() => expect(screen.queryByLabelText(/scan item/i)).toBeNull());
  });

  it("KEEP COUNTING stays put — the escape from an accidental press must be the easy one", async () => {
    await openCountWithOneScan();
    fireEvent.click(back());
    fireEvent.click(screen.getByRole("button", { name: /keep counting/i }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText(/scan item/i)).toBeTruthy();
  });
});
