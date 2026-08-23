// WO-03 — THE OFFLINE UI, RENDERED.
//
// The runtime tests prove what may be sent. What only a render proves is that the SCREEN honours it:
// that a queued note is never called "saved", that a refusal reads as a situation rather than a
// transport code, that a phone which cannot store work says so BEFORE the technician walks away, and
// that a status is legible without colour.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import SyncQueue from "../src/modules/mobile/SyncQueue.jsx";
import SyncIndicator from "../src/shared/ui/SyncIndicator.jsx";
import JobNote from "../src/modules/mobile/JobNote.jsx";
import DictatableNote, { DICTATION_OFFLINE_SUPPORT } from "../src/shared/ui/DictatableNote.jsx";
import { makeIntent, INTENT_TYPE } from "../src/offline/technicianIntent.js";
import { applyFailure } from "../src/offline/syncFailureClassification.js";
import { summarizeQueue } from "../src/offline/intentQueue.js";
import { syncIndicator } from "../src/offline/syncPresentation.js";
import { useOfflineRuntime } from "../src/hooks/useOfflineRuntime";
import { readFileSync } from "node:fs";
import path from "node:path";

// cwd-relative, matching technicianHandheldMobile.test.jsx -- import.meta.url is not a file URL
// under this vitest config.
const source = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const intentFor = (n) => makeIntent({
  type: INTENT_TYPE.NOTE_ADD, workOrderId: "W", principalUid: "uid-hook", captureKey: n, payload: { n },
});
const css = source("src/index.css");

// A signed-in principal, so the hook has a queue to own.
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "uid-hook" } }) }));

afterEach(cleanup);

const intentOf = (type, over = {}) => makeIntent({
  type, workOrderId: over.workOrderId ?? "WO-88", principalUid: "uid-1",
  captureKey: over.captureKey ?? type, payload: over.payload ?? { a: 1 },
  dependsOn: over.dependsOn ?? [],
}).value;

const runtimeOf = (queue, over = {}) => ({
  queue, summary: summarizeQueue(queue), syncing: false, durable: true,
  saveProblem: null, loadProblem: null,
  sync: vi.fn(), retry: vi.fn(), discard: vi.fn(), clearSettled: vi.fn(),
  ...over,
});

// ═══════════════════════════════════════════ the indicator

describe("the sync indicator", () => {
  it("states a count and a consequence, not a spinner", () => {
    render(<SyncIndicator indicator={syncIndicator({ unsynced: 3, attentionCount: 0 })} onOpen={() => {}} />);
    expect(screen.getByText(/3 items waiting to sync/i)).toBeTruthy();
  });

  it("REPORTS WORK NEEDING A PERSON SEPARATELY FROM WORK MERELY WAITING", () => {
    // The failure this prevents: "3 waiting to sync" while one of the three was refused an hour ago.
    render(<SyncIndicator indicator={syncIndicator({ unsynced: 3, attentionCount: 1 })} onOpen={() => {}} />);
    expect(screen.getByText(/1 item needs your attention/i)).toBeTruthy();
    expect(screen.queryByText(/^3 items waiting to sync$/i)).toBeNull();
  });

  it("A PHONE THAT CANNOT SAVE OFFLINE SAYS SO, ahead of everything else", () => {
    render(<SyncIndicator indicator={syncIndicator({ unsynced: 0, attentionCount: 0 }, { durable: false })} onOpen={() => {}} />);
    expect(screen.getByText(/cannot save work offline/i)).toBeTruthy();
  });

  it("offers no controls when there is genuinely nothing outstanding", () => {
    render(<SyncIndicator indicator={syncIndicator({ unsynced: 0, attentionCount: 0 })} onOpen={() => {}} />);
    expect(screen.getByText(/everything is saved/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /view/i })).toBeNull();
  });

  it("there is always a way to open the queue when something is outstanding — NO HIDDEN QUEUE", () => {
    const onOpen = vi.fn();
    render(<SyncIndicator indicator={syncIndicator({ unsynced: 2, attentionCount: 0 })} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /view/i }));
    expect(onOpen).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════ the queue

describe("the sync queue", () => {
  it("a refusal describes the WORLD, never the transport code", () => {
    const refused = applyFailure(intentOf(INTENT_TYPE.EQUIPMENT_INSTALL), {
      code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE",
    });
    const { container } = render(<SyncQueue runtime={runtimeOf([refused])} />);
    expect(screen.getByText(/already installed for another customer/i)).toBeTruthy();
    // The code is NOT the headline. It is available under Details, and only there.
    expect(container.textContent).not.toMatch(/ASSET_INSTALLED_ELSEWHERE/);
    expect(container.textContent).not.toMatch(/failed-precondition/);
  });

  it("the raw code IS available for a support conversation", async () => {
    const refused = applyFailure(intentOf(INTENT_TYPE.LABOR_RECORD), { code: "permission-denied" });
    render(<SyncQueue runtime={runtimeOf([refused])} />);
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(await screen.findByText(/permission-denied/)).toBeTruthy();
  });

  it("EVERY REFUSAL SAYS THE WORK IS PRESERVED — the technician's first fear, answered every time", () => {
    const refused = applyFailure(intentOf(INTENT_TYPE.LABOR_RECORD), { code: "permission-denied" });
    render(<SyncQueue runtime={runtimeOf([refused])} />);
    expect(screen.getByText(/saved on this phone/i)).toBeTruthy();
    expect(screen.getByText(/Nothing has been lost/i)).toBeTruthy();
  });

  it("says what the technician can do next", () => {
    const refused = applyFailure(intentOf(INTENT_TYPE.WORK_ORDER_COMPLETE), {
      code: "permission-denied", details: "NOT_ASSIGNED_TECHNICIAN",
    });
    render(<SyncQueue runtime={runtimeOf([refused])} />);
    expect(screen.getByText(/Talk to dispatch/i)).toBeTruthy();
  });

  it("STATUS IS A WORD, not a colour", () => {
    const refused = applyFailure(intentOf(INTENT_TYPE.NOTE_ADD), { code: "permission-denied" });
    render(<SyncQueue runtime={runtimeOf([refused])} />);
    expect(screen.getByText("Not accepted")).toBeTruthy();
  });

  it("explains work that is waiting on OTHER work, rather than leaving it looking stuck", () => {
    const install = intentOf(INTENT_TYPE.EQUIPMENT_INSTALL, { captureKey: "i" });
    const complete = intentOf(INTENT_TYPE.WORK_ORDER_COMPLETE, {
      captureKey: "c", dependsOn: [{ intentId: install.intentId, required: true }],
    });
    render(<SyncQueue runtime={runtimeOf([install, complete])} />);
    expect(screen.getByText(/Waiting for the installation to be recorded first/i)).toBeTruthy();
  });

  it("DISCARDING IS NEVER ONE TAP, and the cost is stated", () => {
    const discard = vi.fn();
    const refused = applyFailure(intentOf(INTENT_TYPE.NOTE_ADD), { code: "permission-denied" });
    render(<SyncQueue runtime={runtimeOf([refused], { discard })} />);
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(discard).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete this entry for good\?/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));
    expect(discard).toHaveBeenCalledWith(refused.intentId);
  });

  it("items needing a person come FIRST", () => {
    const waiting = intentOf(INTENT_TYPE.NOTE_ADD, { captureKey: "w" });
    const refused = applyFailure(intentOf(INTENT_TYPE.LABOR_RECORD, { captureKey: "r" }), { code: "permission-denied" });
    const { container } = render(<SyncQueue runtime={runtimeOf([waiting, refused])} />);
    const items = [...container.querySelectorAll(".fo-sync-item")];
    expect(items[0].className).toMatch(/attention/);
  });

  it("a device that cannot store work warns inside the queue too", () => {
    render(<SyncQueue runtime={runtimeOf([], { durable: false, saveProblem: "quota_exceeded" })} />);
    expect(screen.getByRole("alert").textContent).toMatch(/not saving work offline.*storage is full/i);
  });

  it("UNREADABLE LOCAL STATE IS NOT 'no work' — and does not invite re-entry", () => {
    render(<SyncQueue runtime={runtimeOf([], { loadProblem: "CORRUPT" })} />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be read/i);
    expect(screen.getByRole("alert").textContent).toMatch(/has not been deleted/i);
  });

  it("touch targets clear 44px on every control", () => {
    // Asserted in CSS rather than layout: jsdom computes no geometry, so the honest check is that
    // the rule exists and applies to the action rows. Real geometry is a device-lab question.
    const refused = applyFailure(intentOf(INTENT_TYPE.NOTE_ADD), { code: "permission-denied" });
    const { container } = render(<SyncQueue runtime={runtimeOf([refused])} />);
    expect(container.querySelector(".fo-sync-item__actions")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ capture

describe("a note captured with no signal", () => {
  const mount = (over = {}) => {
    const enqueue = over.enqueue ?? vi.fn().mockResolvedValue({ queued: true, durable: true, intentId: "int_1" });
    const save = over.save ?? vi.fn().mockRejectedValue(Object.assign(new Error("down"), { code: "unavailable" }));
    render(<JobNote workOrderId="WO-1" offline={{ enqueue, principalUid: "uid-1" }} deps={{ save }} />);
    return { enqueue, save };
  };
  const open = () => fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
  const type = (t) => fireEvent.change(screen.getByLabelText(/note for this job/i), { target: { value: t } });

  it("IS NEVER CALLED SAVED", async () => {
    mount();
    open();
    type("Compressor swapped.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(screen.getByText(/waiting to sync/i)).toBeTruthy();
    expect(screen.queryByText(/note saved/i)).toBeNull();
  });

  it("queues through the shared runtime rather than a path of its own", async () => {
    const { enqueue } = mount();
    open();
    type("Compressor swapped.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    await waitFor(() => expect(enqueue).toHaveBeenCalled());
    const intent = enqueue.mock.calls[0][0];
    expect(intent.valid).toBe(true);
    expect(intent.value.type).toBe(INTENT_TYPE.NOTE_ADD);
    expect(intent.value.payload.executionNote).toBe("Compressor swapped.");
  });

  it("A REFUSAL IS NOT QUEUED — a clear no must not become an indefinite maybe", async () => {
    const { enqueue } = mount({
      save: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "permission-denied" })),
    });
    open();
    type("Compressor swapped.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(enqueue).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("A PHONE THAT CANNOT KEEP IT KEEPS THE DRAFT ON SCREEN instead of promising to sync", async () => {
    mount({ enqueue: vi.fn().mockResolvedValue({ queued: true, durable: false, reason: "quota_exceeded" }) });
    open();
    type("Compressor swapped.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/could not save your note offline/i);
    // The only copy that exists is the one in the box, so the box still has it.
    expect(screen.getByLabelText(/note for this job/i).value).toBe("Compressor swapped.");
  });

  it("with no runtime at all, the screen behaves exactly as it always did", async () => {
    const save = vi.fn().mockResolvedValue({ success: true, workOrderId: "WO-1" });
    render(<JobNote workOrderId="WO-1" deps={{ save }} />);
    open();
    type("Nothing offline about this.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(save).toHaveBeenCalledWith("WO-1", { executionNote: "Nothing offline about this." });
    expect(screen.getByText(/note saved/i)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ §37

describe("dictation, offline", () => {
  it("is classified PLATFORM_DEPENDENT — observed, not asserted", () => {
    expect(DICTATION_OFFLINE_SUPPORT).toBe("PLATFORM_DEPENDENT");
  });

  it("a device that knows it is offline is told to TYPE, and typing still works", () => {
    const recognizerFactory = vi.fn();
    render(<DictatableNote value="" onChange={() => {}} deps={{ recognizerFactory, navigator: { onLine: false } }} />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(recognizerFactory).not.toHaveBeenCalled();
    expect(screen.getByText(/Dictation needs a connection/i)).toBeTruthy();
    expect(screen.getByText(/typed notes save offline/i)).toBeTruthy();
    // The textarea is NEVER disabled by this. Losing dictation costs speed, not the note.
    expect(screen.getByRole("textbox").disabled).toBeFalsy();
  });

  it("a recogniser that cannot reach its service reports THAT, not a generic failure", () => {
    let handlers = {};
    const recognizerFactory = () => ({
      start() {}, stop() {},
      set onerror(fn) { handlers.error = fn; },
      set onresult(fn) { handlers.result = fn; },
      set onend(fn) { handlers.end = fn; },
    });
    render(<DictatableNote value="" onChange={() => {}} deps={{ recognizerFactory, navigator: { onLine: true } }} />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    act(() => { handlers.error({ error: "network" }); });
    expect(screen.getByText(/Dictation needs a connection/i)).toBeTruthy();
  });

  it("a denied microphone is still its own, different message", () => {
    let handlers = {};
    const recognizerFactory = () => ({
      start() {}, stop() {},
      set onerror(fn) { handlers.error = fn; },
      set onresult(fn) { handlers.result = fn; },
      set onend(fn) { handlers.end = fn; },
    });
    render(<DictatableNote value="" onChange={() => {}} deps={{ recognizerFactory, navigator: { onLine: true } }} />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    act(() => { handlers.error({ error: "not-allowed" }); });
    expect(screen.getByText(/microphone was not allowed/i)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ §35 / §36 — the phone, and everyone using it

describe("mobile certification — 320 / 375 / 414", () => {
  // jsdom does not lay out, so geometry is certified against the STYLESHEET. That is where the rule
  // actually regresses: somebody restyles a card and the minimum quietly disappears, and no rendered
  // assertion notices because nothing in jsdom has a size to check.
  it("EVERY sync control carries the 44px rule", () => {
    // The rule is on the SURFACE, not on the action rows. Attaching it per-row is what let the
    // queue header's Close button and the queue-level Sync now ship at 31px -- caught by measuring a
    // real browser, not by this file, which is why the assertion now names the surface selector.
    expect(css).toMatch(/\.fo-sync-queue button\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.fo-sync-item__actions button\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.fo-sync-indicator__button\s*\{[^}]*min-height:\s*44px/);
  });

  it("NOTHING can overflow horizontally at 320px", () => {
    // The two ways it happens: a fixed pixel width in the markup, and an unbreakable string — which
    // for this surface means an intent id, the longest thing on the screen.
    for (const file of ["src/modules/mobile/SyncQueue.jsx", "src/shared/ui/SyncIndicator.jsx"]) {
      expect(source(file)).not.toMatch(/width:\s*\d{3,}px/);
      expect(source(file)).not.toMatch(/minWidth:\s*['"]?\d{3,}/);
    }
    expect(css).toMatch(/\.fo-sync-item__technical\s*\{[^}]*overflow-wrap:\s*anywhere/);
    // At 320 the two-up action row wraps into an unreadable stagger, so it stacks instead.
    expect(css).toMatch(/@media \(max-width: 360px\)/);
  });

  it("the queue is CARDS, not a table — a table at 320px is a horizontal scrollbar with extra steps", () => {
    expect(source("src/modules/mobile/SyncQueue.jsx")).not.toMatch(/<table|<thead|role="grid"/);
  });

  it("both surfaces wrap rather than clip when a label is long", () => {
    expect(css).toMatch(/\.fo-sync-indicator\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.fo-sync-item__what\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

describe("accessibility", () => {
  it("EVERY state is a WORD, so nothing depends on colour", () => {
    // The full vocabulary, rendered. A greyscale screenshot in a support ticket has to be readable.
    const states = [
      [{ code: "unavailable" }, "Waiting to sync"],
      [{ code: "permission-denied" }, "Not accepted"],
      [{ code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE" }, "Needs review — changed elsewhere"],
    ];
    for (const [failure, word] of states) {
      cleanup();
      const i = failure.code === "unavailable"
        ? intentOf(INTENT_TYPE.NOTE_ADD)
        : applyFailure(intentOf(INTENT_TYPE.NOTE_ADD), failure);
      render(<SyncQueue runtime={runtimeOf([i])} />);
      expect(screen.getByText(word)).toBeTruthy();
    }
  });

  it("the indicator is announced without stealing focus", () => {
    render(<SyncIndicator indicator={syncIndicator({ unsynced: 1, attentionCount: 0 })} onOpen={() => {}} />);
    // role=status, not alert: an interruption mid-way through entering time is worse than a late read.
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("a device that cannot store work IS an alert — that one does interrupt, and should", () => {
    render(<SyncQueue runtime={runtimeOf([], { durable: false })} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("both surfaces are landmarked, so a screen reader can jump to them", () => {
    render(<SyncQueue runtime={runtimeOf([])} />);
    expect(screen.getByRole("region", { name: /sync queue/i })).toBeTruthy();
    cleanup();
    render(<SyncIndicator indicator={syncIndicator({ unsynced: 1, attentionCount: 0 })} onOpen={() => {}} />);
    expect(screen.getByRole("region", { name: /sync status/i })).toBeTruthy();
  });

  it("expandable details announce their state", () => {
    const refused = applyFailure(intentOf(INTENT_TYPE.NOTE_ADD), { code: "permission-denied" });
    render(<SyncQueue runtime={runtimeOf([refused])} />);
    const button = screen.getByRole("button", { name: /details/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

// ═══════════════════════════════════════════ the two races integration found

describe("the queue hook, under real timing", () => {
  // Both of these shipped in WO-03 and neither runtime test could see them: every runtime proof
  // enqueued through separate awaited actions, so no two mutations ever landed in one tick and no
  // capture ever raced the initial read from storage.
  it("TWO CAPTURES IN ONE TICK BOTH SURVIVE", async () => {
    // Capturing an installation and its dependent completion does exactly this. Reading the queue
    // from a render-old closure meant the second persisted a queue built without the first, and the
    // installation vanished behind a "pending sync" that was not true.
    let rt;
    function Probe() { rt = useOfflineRuntime(); return null; }
    render(<Probe />);
    await act(async () => {
      await rt.enqueue(intentFor("a"));
      await rt.enqueue(intentFor("b"));
    });
    expect(rt.queue).toHaveLength(2);
    expect(rt.queue.map((i) => i.payload.n)).toEqual(["a", "b"]);
  });

  it("A CAPTURE MADE BEFORE STORAGE FINISHES LOADING IS NOT WIPED", async () => {
    // Open the app, tap straight into a note. The read from storage resolves afterwards, and
    // assigning it over the top would delete the entry the technician just made.
    let rt;
    function Probe() { rt = useOfflineRuntime(); return null; }
    render(<Probe />);
    await act(async () => { await rt.enqueue(intentFor("early")); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(rt.queue.map((i) => i.payload.n)).toContain("early");
  });
});
