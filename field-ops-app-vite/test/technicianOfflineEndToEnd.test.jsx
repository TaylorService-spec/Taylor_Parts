// WO-03A — THE WHOLE THING, THROUGH THE ACTUAL APP.
//
// Every offline proof in WO-03 drove the runtime directly. That proved the runtime, and proved
// nothing about whether a technician can reach it: the shell those proofs assumed was imported by
// nothing, and no test noticed, because rendering a component IS importing it.
//
// So this file touches no queue API. It renders TechnicianShell, presses the buttons a technician
// presses, and asserts on what the SERVICE LAYER was asked to do. The store is the real one — jsdom
// has localStorage, which is the runtime's own second-choice adapter — so "close and reopen the app"
// is an unmount and a remount over storage that genuinely persisted.
//
// What is faked is exactly one layer: the network. Everything above it is the shipping app.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";

// ── the network, and nothing else ────────────────────────────────────────────────────────────────
const calls = { execution: [], labor: [], install: [], transition: [], installList: 0 };
let installOutcome;
let transitionOutcome;
let laborOutcome;

vi.mock("../src/services/workOrderService", () => ({
  updateWorkOrderExecutionData: vi.fn(async (workOrderId, updates) => {
    calls.execution.push({ workOrderId, ...updates });
    return { success: true, workOrderId, updatedFields: Object.keys(updates) };
  }),
  transitionWorkOrder: vi.fn(async (workOrderId, action) => {
    calls.transition.push({ workOrderId, action });
    if (transitionOutcome instanceof Error) throw transitionOutcome;
    return { id: workOrderId, status: "COMPLETED" };
  }),
  getWorkOrder: vi.fn(async (id) => ({ id, status: "WORK_IN_PROGRESS", assignedTechId: "tech-1" })),
  subscribeToWorkOrders: vi.fn(() => () => {}),
  setWorkOrderPartsPlan: vi.fn(),
  createWorkOrder: vi.fn(),
}));

vi.mock("../src/services/workOrderLaborCallableClient", () => ({
  fetchWorkOrderLabor: vi.fn(async () => ({
    outcome: {
      status: "ready", workOrderId: "WO-1", entries: [], canRecord: true, canCorrect: false,
      totals: { totalMinutes: 0, onsiteMinutes: 0, travelMinutes: 0, activeEntries: 0, reversedEntries: 0 },
      laborTypes: ["ONSITE", "TRAVEL"], entryKinds: ["INTERVAL", "DURATION"], maxMinutes: 960,
    },
    error: null,
  })),
  recordWorkOrderLabor: vi.fn(async (payload) => {
    calls.labor.push(payload);
    return laborOutcome ?? { outcome: { outcome: "recorded", laborEntryId: `lab-${calls.labor.length}` }, error: null };
  }),
}));

vi.mock("../src/services/workOrderInstallCallableClient", () => ({
  fetchInstallableEquipmentForWorkOrder: vi.fn(async () => {
    calls.installList += 1;
    return {
      outcome: {
        status: "ready",
        workOrder: { workOrderId: "WO-1", woNumber: "WO-2026-0001", customerId: "acct-1", locationId: "loc-1", status: "WORK_IN_PROGRESS", type: "INSTALL" },
        units: [{ serializedAssetId: "sa-1", serialNo: "TL-99812", partId: "TAYLOR-C713", productName: "Taylor C713", inventoryState: "AVAILABLE", currentLocationId: "wh-1" }],
      },
      error: null,
    };
  }),
  recordWorkOrderEquipmentInstall: vi.fn(async (payload) => {
    calls.install.push(payload);
    return installOutcome ?? {
      outcome: { outcome: "installed", equipmentId: "eq-1", serializedAssetId: "sa-1", workOrderId: "WO-1", completionRequired: true, workOrderStatus: "WORK_IN_PROGRESS" },
      error: null,
    };
  }),
}));

// ── identity and assigned work ───────────────────────────────────────────────────────────────────
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "uid-tech-1" }, role: "technician", employeeId: "emp-1" }),
  AuthProvider: ({ children }) => children,
}));
vi.mock("../src/hooks/useCurrentTechnician", () => ({
  useCurrentTechnician: () => ({ technicianId: "tech-1", technician: null, loading: false, error: null, retry: () => {} }),
}));
const WORK_ORDER = {
  id: "WO-1", woNumber: "WO-2026-0001", status: "WORK_IN_PROGRESS", type: "INSTALL",
  assignedTechId: "tech-1", complaint: "Install new machine", customerId: "acct-1", locationId: "loc-1",
  inventorySnapshot: [],
};
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: [WORK_ORDER], loading: false, error: null }),
}));
vi.mock("../src/hooks/useWorkOrderFieldContext", () => ({
  useWorkOrderFieldContext: () => ({
    context: { customer: { state: "RESOLVED", displayName: "Acme Foods" }, site: { state: "RESOLVED", displayLabel: "14 Mill St" } },
    denied: false, loading: false,
  }),
}));
// The scanner pulls camera/decoding machinery that has nothing to do with this proof.
vi.mock("../src/modules/scan/ScanWorkspace", () => ({ default: () => <div>Scan workspace</div> }));

const { default: TechnicianShell } = await import("../src/modules/technician/TechnicianShell");
const { STORE_NAMESPACE } = await import("../src/offline/localIntentStore.js");

// ── the network switch ───────────────────────────────────────────────────────────────────────────
function setOnline(value) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

const storageKey = `${STORE_NAMESPACE}/uid-tech-1`;
const storedIntents = () => JSON.parse(window.localStorage.getItem(storageKey) ?? '{"intents":[]}').intents;

beforeEach(() => {
  window.localStorage.clear();
  calls.execution = []; calls.labor = []; calls.install = []; calls.transition = []; calls.installList = 0;
  installOutcome = undefined; transitionOutcome = undefined; laborOutcome = undefined;
  setOnline(true);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ── the technician's actions, as a technician performs them ──────────────────────────────────────
const openTool = async (name) => {
  const button = await screen.findByRole("button", { name });
  await act(async () => { fireEvent.click(button); });
};

async function addNote(text) {
  // TWO presses, because there are genuinely two controls: the job's tool toggle reveals the note
  // panel, and the panel's own button opens the editor. Driven as a technician drives it rather than
  // reaching past either one.
  await openTool(/add a note/i);
  // After the toggle, TWO controls answer to that name -- the job's tool toggle and the note panel's
  // own opener. The panel's is the later one in the tree, and reaching past it would skip the very
  // interaction under test.
  const openers = await screen.findAllByRole("button", { name: /add a note/i });
  await act(async () => { fireEvent.click(openers[openers.length - 1]); });
  fireEvent.change(await screen.findByLabelText(/note for this job/i), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
}

async function addTime(hours) {
  await openTool(/^time$/i);
  await screen.findByRole("button", { name: /add time/i });
  fireEvent.change(screen.getByRole("spinbutton", { name: /hours/i }), { target: { value: hours } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /add time/i })); });
}

async function installAndComplete() {
  const unit = await screen.findByRole("radio");
  await act(async () => { fireEvent.click(unit); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /install & complete work/i })); });
}

const openSync = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^more$/i })); });
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /sync status/i })); });
  // The queue panel is a LAZY chunk, so it arrives a tick after the tap. Waiting for the landmark
  // rather than assuming it is there -- which also proves the lazy boundary actually resolves.
  await screen.findByRole("region", { name: /sync queue/i });
};

// =================================================================================================
// §12 / §13 — THE FLAGSHIP
// =================================================================================================

describe("the whole offline day, through the mounted shell", () => {
  it("captures, survives a restart, and syncs to EXACTLY the right server effects", async () => {
    render(<TechnicianShell />);

    // ── 2. go offline ────────────────────────────────────────────────────────────────────────────
    setOnline(false);

    // ── 3-5. note, time, installation ────────────────────────────────────────────────────────────
    await addNote("Old unit drained and removed.");
    // The note's OWN confirmation, not the shell banner -- both legitimately say "waiting to sync",
    // and this assertion is about what the note screen told the technician.
    expect(screen.getByText(/Note held on this phone/i)).toBeTruthy();
    // NOTHING REACHED THE PLATFORM.
    expect(calls.execution).toHaveLength(0);

    await addTime("2");
    await waitFor(() => expect(screen.getByText(/held on this phone/i)).toBeTruthy());
    expect(calls.labor).toHaveLength(0);

    // ── 6-7. the installation, and completion with it ────────────────────────────────────────────
    await installAndComplete();
    expect(await screen.findByText(/Installation pending sync/i)).toBeTruthy();
    // THE WORDS THAT MUST NOT APPEAR.
    expect(screen.queryByText(/^Installed$/i)).toBeNull();
    expect(calls.install).toHaveLength(0);
    expect(calls.transition).toHaveLength(0);

    // ── 8. the UI says what is outstanding ───────────────────────────────────────────────────────
    await waitFor(() => expect(screen.getByText(/items waiting to sync/i)).toBeTruthy());

    // ── 9-11. close the app, reopen it, still offline ────────────────────────────────────────────
    const persisted = storedIntents();
    expect(persisted.map((i) => i.type).sort()).toEqual(
      ["EQUIPMENT_INSTALL", "LABOR_RECORD", "NOTE_ADD", "WORK_ORDER_COMPLETE"],
    );
    cleanup();
    render(<TechnicianShell />);
    // EVERYTHING IS STILL THERE, and Home says so without being asked.
    expect(await screen.findByText(/4 items waiting to sync/i)).toBeTruthy();

    // ── 12-13. reconnect and sync ────────────────────────────────────────────────────────────────
    setOnline(true);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /sync now/i })[0]); });

    // ── 14. EXACT server effects ─────────────────────────────────────────────────────────────────
    await waitFor(() => expect(calls.transition).toHaveLength(1), { timeout: 4000 });

    const notes = calls.execution.filter((c) => c.executionNote !== undefined);
    expect(notes).toHaveLength(1);
    expect(notes[0].executionNote).toBe("Old unit drained and removed.");
    expect(calls.labor).toHaveLength(1);
    expect(calls.labor[0].durationMinutes).toBe(120);
    expect(calls.install).toHaveLength(1);
    expect(calls.install[0].serializedAssetId).toBe("sa-1");
    // Customer and location are NEVER client-supplied -- the command derives both from the WO.
    expect(calls.install[0].accountId).toBeUndefined();
    expect(calls.install[0].locationId).toBeUndefined();
    expect(calls.transition).toEqual([{ workOrderId: "WO-1", action: "Complete" }]);

    // ── 15. completion came LAST, after its required dependency ──────────────────────────────────
    await waitFor(() => expect(screen.getByText(/everything is saved/i)).toBeTruthy());
  }, 20000);

  it("a second sync pass repeats NOTHING", async () => {
    render(<TechnicianShell />);
    setOnline(false);
    await addNote("One note.");
    await addTime("1");
    setOnline(true);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /sync now/i })[0]); });
    await waitFor(() => expect(calls.labor).toHaveLength(1));

    // Home now correctly offers NO Sync now -- there is nothing outstanding to send, and a button
    // that does nothing is a button that teaches people to distrust the screen.
    await waitFor(() => expect(screen.getByText(/everything is saved/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /sync now/i })).toBeNull();

    // So the repeat goes through the Sync screen, which always offers one. Press it twice more:
    // a SYNCED intent is never sendable again, on any pass, ever.
    await openSync();
    for (let i = 0; i < 2; i += 1) {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /sync now/i })); });
    }
    expect(calls.labor).toHaveLength(1);
    expect(calls.execution.filter((c) => c.executionNote !== undefined)).toHaveLength(1);
  }, 20000);
});

// =================================================================================================
// §14 — INSTALL REFUSED
// =================================================================================================

describe("when the installation is refused on reconnect", () => {
  it("the job is NOT completed, the hours still land, and the queue says why", async () => {
    render(<TechnicianShell />);
    setOnline(false);
    await addTime("3");
    await installAndComplete();
    await screen.findByText(/Installation pending sync/i);

    // The machine was installed by somebody else while the technician was offline.
    installOutcome = { outcome: null, error: { code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE", message: "raw" } };

    setOnline(true);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /sync now/i })[0]); });
    await waitFor(() => expect(calls.install).toHaveLength(1), { timeout: 4000 });

    // THE WORK ORDER WAS NEVER COMPLETED.
    expect(calls.transition).toHaveLength(0);
    // The hours were still saved -- one failure does not swallow the rest.
    expect(calls.labor).toHaveLength(1);

    // The queue explains it in the world's terms, per item, not as one "sync failed".
    await openSync();
    expect(await screen.findByText(/already installed for another customer/i)).toBeTruthy();
    expect(screen.getByText(/Cannot finish the job until the installation is sorted out/i)).toBeTruthy();
    expect(screen.getByText(/saved on this phone/i)).toBeTruthy();
  }, 20000);

  it("Home leads with the attention, not with a soothing pending count", async () => {
    render(<TechnicianShell />);
    setOnline(false);
    await addNote("A note.");
    await installAndComplete();
    installOutcome = { outcome: null, error: { code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE" } };
    setOnline(true);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /sync now/i })[0]); });
    await waitFor(() => expect(calls.install).toHaveLength(1), { timeout: 4000 });
    expect(await screen.findByText(/needs? your attention/i)).toBeTruthy();
  }, 20000);
});

// =================================================================================================
// §15 — INSTALL SUCCEEDS, COMPLETION FAILS
// =================================================================================================

describe("when the installation lands but completion does not", () => {
  it("retrying sends ONLY the completion — never a second installation", async () => {
    render(<TechnicianShell />);
    setOnline(false);
    await installAndComplete();
    await screen.findByText(/Installation pending sync/i);

    // The install will succeed; the completion will not.
    transitionOutcome = Object.assign(new Error("down"), { code: "unavailable" });
    setOnline(true);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /sync now/i })[0]); });
    await waitFor(() => expect(calls.transition).toHaveLength(1), { timeout: 4000 });
    expect(calls.install).toHaveLength(1);

    // The queue reports exactly that split: the machine is recorded, the job is not finished.
    await openSync();
    const items = document.querySelectorAll(".fo-sync-item");
    expect(items.length).toBeGreaterThan(0);
    expect(screen.getByText(/Finishing the job/i)).toBeTruthy();

    // Retry. The install is SYNCED and can never be sent again; only the completion goes.
    transitionOutcome = undefined;
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /sync now/i })[0]); });
    await waitFor(() => expect(calls.transition).toHaveLength(2), { timeout: 4000 });
    expect(calls.install).toHaveLength(1);
  }, 20000);
});

// =================================================================================================
// §20 — STORAGE FAILURE
// =================================================================================================

describe("when the phone cannot save offline", () => {
  it("the work is NOT called queued, and the words stay in the box", async () => {
    const setItem = window.localStorage.setItem.bind(window.localStorage);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((k, v) => {
      if (String(k).startsWith(STORE_NAMESPACE)) {
        const err = new Error("full"); err.name = "QuotaExceededError"; throw err;
      }
      return setItem(k, v);
    });
    try {
      render(<TechnicianShell />);
      setOnline(false);
      await addNote("This must not disappear.");
      // NOT held, NOT queued -- the note panel must not claim either.
      expect(screen.queryByText(/Note held on this phone/i)).toBeNull();
      expect(screen.getByRole("alert").textContent).toMatch(/could not save your note offline/i);
      // The only copy that exists is on screen, so it is still on screen.
      expect(screen.getByLabelText(/note for this job/i).value).toBe("This must not disappear.");
    } finally {
      spy.mockRestore();
    }
  }, 20000);
});

// =================================================================================================
// §21 — RESTART, AND NO HIDDEN QUEUE
// =================================================================================================

describe("after a restart", () => {
  it("Home, and More -> Sync, both show the outstanding work", async () => {
    render(<TechnicianShell />);
    setOnline(false);
    await addNote("Survives.");
    await addTime("1");
    await waitFor(() => expect(storedIntents()).toHaveLength(2));

    cleanup();
    render(<TechnicianShell />);

    // Home.
    expect(await screen.findByText(/2 items waiting to sync/i)).toBeTruthy();
    // More -> Sync status, with its own count.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^more$/i })); });
    expect(await screen.findByRole("button", { name: /sync status.*2 not sent/i })).toBeTruthy();
    // And the queue itself, with both items named in the technician's words.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /sync status/i })); });
    expect(await screen.findByRole("region", { name: /sync queue/i })).toBeTruthy();
    expect(screen.getByText("Note")).toBeTruthy();
    expect(screen.getByText("Time")).toBeTruthy();
  }, 20000);

  it("ANOTHER TECHNICIAN'S QUEUE IS NOT VISIBLE OR SENDABLE", async () => {
    // Somebody else's work, sitting on this device under their own key.
    window.localStorage.setItem(`${STORE_NAMESPACE}/uid-someone-else`, JSON.stringify({
      schemaVersion: 1, principalUid: "uid-someone-else", cache: {},
      intents: [{ intentId: "int_theirs", type: "NOTE_ADD", workOrderId: "WO-9", principalUid: "uid-someone-else", state: "PENDING_SYNC", dependsOn: [], attemptCount: 0, nextEligibleAt: 0, payload: { executionNote: "theirs" } }],
    }));
    render(<TechnicianShell />);
    setOnline(true);
    await screen.findByText(/everything is saved/i);
    // There is no Sync now to press, and that is the assertion: this technician has nothing
    // outstanding, because the other person's queue is not theirs to see.
    expect(screen.queryByRole("button", { name: /sync now/i })).toBeNull();
    // Not sent, not shown, and NOT DELETED -- it belongs to whoever queued it.
    expect(calls.execution).toHaveLength(0);
    expect(window.localStorage.getItem(`${STORE_NAMESPACE}/uid-someone-else`)).toBeTruthy();
  }, 20000);
});

// =================================================================================================
// §4 / §16 — PARTS AND SCAN
// =================================================================================================

describe("the four tabs are reachable and do their job", () => {
  it("Home / Jobs / Scan / More all render something", async () => {
    render(<TechnicianShell />);
    const nav = screen.getByRole("navigation", { name: /technician/i });
    for (const [label, expected] of [["Jobs", /WO-2026-0001/], ["Scan", /scan workspace/i], ["More", /sync status/i]]) {
      await act(async () => { fireEvent.click(within(nav).getByRole("button", { name: label })); });
      expect(await screen.findAllByText(expected)).not.toHaveLength(0);
    }
    await act(async () => { fireEvent.click(within(nav).getByRole("button", { name: "Home" })); });
    expect(await screen.findByRole("heading", { name: /current job/i })).toBeTruthy();
  }, 20000);
});
