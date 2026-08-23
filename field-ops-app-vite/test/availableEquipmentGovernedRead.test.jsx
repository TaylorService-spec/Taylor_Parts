// Sandbox-fidelity Part 3 -- regression pinning the fix for AvailableEquipment.jsx defaulting to the
// inert source and telling the user the Serialized Asset registry "is not available yet". That copy
// went stale once Wave 7 shipped the identity contract, the governed getAvailableEquipment read, and
// SERIAL receiving. This tab now reads through hooks/useAvailableEquipmentSource.js (a REAL governed
// callable), and the component itself no longer accepts an injected `source` prop -- the ONLY
// production-shaped source is the hook. Tests below mock the HOOK module directly (the codebase's
// established render-test convention -- see test/dispatchSurfacesErrorState.test.jsx), never the
// legacy `source` prop, and never touch Firebase/network.
//
// Proves, structurally and behaviorally:
//   1. The stale "registry does not exist"/"not available yet" copy is gone from source.
//   2. LOADING / DENIED / UNAVAILABLE / EMPTY / READY are five DISTINCT, correctly-rendered states --
//      denied != empty, empty != failure, loading is visibly its own state (never silently blank).
//   3. A READY read with a genuinely-available row renders it; an installed/otherwise-unavailable row
//      injected through the mocked hook (simulating a malformed/adversarial upstream) is never shown --
//      the pure P1a gate (selectAvailableSerializedAssets) still applies to whatever the hook returns.
//   4. No raw Firebase/Functions error text or uid ever reaches the rendered DOM.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// AvailableEquipment gained an Install action (PR: equipment install UI). These are its NEW
// dependencies, declared here because this suite renders that component -- an undeclared dependency
// is not a neutral omission, it throws on first render and takes every case in the file with it.
// canInstall is FALSE so this suite keeps testing exactly what it was written to test: the governed
// read's own states, with no install control in the way.
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "test-uid" } }) }));
vi.mock("../src/access/useEquipmentInstallCapability", () => ({
  useEquipmentInstallCapability: () => ({ canInstall: false }),
}));
vi.mock("../src/hooks/useWholeUnitParts", () => ({
  useWholeUnitParts: () => ({ parts: [], loading: false, denied: false, unavailable: false }),
}));
// Only useNavigate is replaced. Mocking the whole module strips MemoryRouter and every other export
// the suite relies on.
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));
vi.mock("../src/hooks/useAccountPicker", () => ({ useAccountPicker: () => ({ options: [], message: null, loading: false, error: null }) }));
vi.mock("../src/hooks/useAvailableEquipmentSource", () => ({ useAvailableEquipmentSource: vi.fn() }));

import { useAvailableEquipmentSource } from "../src/hooks/useAvailableEquipmentSource";
import AvailableEquipment from "../src/modules/equipment/AvailableEquipment";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Strips `//` line comments (this file's own source carries explanatory prose that legitimately
// names the retired phrases/identifiers in its migration-history comments -- what must actually be
// absent is EXECUTABLE reference/copy, not a mention in a code comment).
function stripLineComments(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("AvailableEquipment -- stale inert/registry-doesn't-exist copy is gone", () => {
  it("no longer renders 'not available yet' / 'does not exist' copy (checked outside comments)", () => {
    const codeOnly = stripLineComments(
      fs.readFileSync(path.join(__dirname, "../src/modules/equipment/AvailableEquipment.jsx"), "utf8")
    );
    expect(codeOnly).not.toMatch(/not (yet )?available/i);
    expect(codeOnly).not.toMatch(/does not exist/i);
    expect(codeOnly).not.toMatch(/registry.*not (built|available)/i);
  });

  it("no longer accepts an injected `source` prop -- the governed hook is the only production source", () => {
    const codeOnly = stripLineComments(
      fs.readFileSync(path.join(__dirname, "../src/modules/equipment/AvailableEquipment.jsx"), "utf8")
    );
    expect(codeOnly).not.toMatch(/inertSerializedAssetSource/);
  });
});

describe("AvailableEquipment -- LOADING / DENIED / UNAVAILABLE / EMPTY / READY are distinct", () => {
  it("LOADING renders a visible loading state, not blank and not an error", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: false, status: "loading", assets: [] });
    render(<AvailableEquipment />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("DENIED renders an alert distinct from empty/loading copy", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: false, status: "denied", assets: [] });
    render(<AvailableEquipment />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no available/i)).toBeNull();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it("UNAVAILABLE (a real read failure) renders an alert, distinct from DENIED's copy", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: false, status: "unavailable", assets: [] });
    render(<AvailableEquipment />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).not.toMatch(/not able to view/i); // that's the DENIED copy specifically
  });

  it("EMPTY (connected, ready, nothing available) is NOT an error -- no alert role", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: true, status: "ready", assets: [] });
    render(<AvailableEquipment />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/no available equipment/i)).toBeTruthy();
  });

  it("READY with a genuinely-available asset renders it; an installed asset from the same hook never renders", () => {
    useAvailableEquipmentSource.mockReturnValue({
      connected: true,
      status: "ready",
      assets: [
        { serialNo: "SN-AVAIL-1", partId: "P-1", currentEquipmentId: null, availableForAssignment: true, status: "AVAILABLE", location: "loc-1" },
        // Simulates a malformed/adversarial upstream claiming installed+available at once -- the pure
        // P1a gate (selectAvailableSerializedAssets, reused unmodified) must still exclude it.
        { serialNo: "SN-INSTALLED", partId: "P-2", currentEquipmentId: "EQ-9", availableForAssignment: true, status: "INSTALLED", location: "loc-2" },
      ],
    });
    render(<AvailableEquipment />);
    expect(screen.getByText(/SN-AVAIL-1/)).toBeTruthy();
    expect(screen.queryByText(/SN-INSTALLED/)).toBeNull();
  });
});

describe("AvailableEquipment -- no raw error leakage", () => {
  it("a denied/unavailable read never renders a raw Firebase code, path, or uid", () => {
    const RAW = /permission-denied|functions\/|firestore\/|FirebaseError|serialized_assets\/|[A-Za-z0-9]{20,}/;
    useAvailableEquipmentSource.mockReturnValue({ connected: false, status: "denied", assets: [] });
    const { container: deniedContainer } = render(<AvailableEquipment />);
    expect(deniedContainer.textContent).not.toMatch(RAW);
    cleanup();

    useAvailableEquipmentSource.mockReturnValue({ connected: false, status: "unavailable", assets: [] });
    const { container: unavailContainer } = render(<AvailableEquipment />);
    expect(unavailContainer.textContent).not.toMatch(RAW);
  });
});
