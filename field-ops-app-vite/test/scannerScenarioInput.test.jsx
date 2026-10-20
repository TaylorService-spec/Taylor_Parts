// SCAN-PORT (client half) -- the INPUT side of the thirteen scanner scenarios, with no hardware and no network.
//
// The server half (functions/test/scannerScenariosOnEosPostgres.test.mjs) proves what the EOS commands do with a scanned value.
// This file proves how the value GETS THERE from the two physical inputs the sandbox scenarios could never exercise from a script:
//
//   WEDGE   a hardware scanner is a keyboard: it types the code and presses Enter (a form submit) and may surround the code
//           with whitespace -- scenario 2 scanned "  <barcode>  " and expected the trimmed code to resolve.
//   CAMERA  a decoder (BarcodeDetector) that reports the SAME label every frame while it sits in view.
//
// Both must converge on ONE value the workflow can resolve (scannedIdentity.js), whatever the label format. test/scanInput.test.jsx
// covers the field's focus, feedback and camera degradation; this file adds the paths it leaves out: a camera that actually DECODES,
// and the barcode formats a real label carries.
import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import ScanInput from "../src/shared/ui/ScanInput.jsx";
import { normalizeScanToken, resolveScannedIdentity, SCAN_RESOLUTION } from "../src/domain/scannedIdentity.js";
import { REPEAT_WINDOW_MS, SCAN_SOURCE } from "../src/domain/scanInputPolicy.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete navigator.mediaDevices; });

// What a label can carry. Each is a value the sandbox scenarios (or the warehouse) really scan.
const LABELS = Object.freeze({
  ean13: "0123456789012",
  upcA: "012345678905",
  code128: "BC-SCN-7731",
  partCode: "PRT-1001",
  partCodeLowercase: "prt-1001",
  qrJson: '{"partId":"PRT-1001"}',
  qrUrl: "https://eos.example/scan?part=PRT-1001",
  vendorPrefixed: "TAYLOR-PART:PRT-1001",
});

// ────────────────────────────────────────────── the keyboard wedge

describe("Wedge: a physical scanner is a keyboard that presses Enter", () => {
  let clock = 0;
  const deps = () => ({ now: () => (clock += 1000) });
  const field = () => screen.getByLabelText(/scan item/i);
  const wedge = (value) => { fireEvent.change(field(), { target: { value } }); fireEvent.submit(field().closest("form")); };
  beforeEach(() => { clock = 0; });

  it("the Enter a wedge sends is a form submit: the field lives in a form with a submit button, so implicit submission works on any wedge", () => {
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    const form = field().closest("form");
    expect(form).toBeTruthy();
    expect(form.querySelector('button[type="submit"]')).toBeTruthy();
    expect(field().getAttribute("type") ?? "text").toBe("text");
  });

  it.each(Object.entries({ ean13: LABELS.ean13, upcA: LABELS.upcA, code128: LABELS.code128, partCode: LABELS.partCode }))(
    "a %s label arrives exactly as printed, with a wedge's surrounding whitespace removed", (_name, label) => {
      const onScan = vi.fn();
      render(<ScanInput onScan={onScan} deps={deps()} />);
      wedge(`  ${label}  `);
      expect(onScan).toHaveBeenCalledTimes(1);
      expect(onScan).toHaveBeenCalledWith(label);
    },
  );

  it("nothing but whitespace is not a scan: it never reaches the workflow (the server would refuse a blank request anyway)", () => {
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={deps()} />);
    wedge("   ");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("a wedge STUTTER (the same code twice within the keyed window) is one scan; the same code 300ms later is a second box", () => {
    const frozen = { now: vi.fn() };
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={frozen} />);
    frozen.now.mockReturnValue(10_000);
    wedge(LABELS.ean13);
    frozen.now.mockReturnValue(10_000 + 100); // inside the 250ms keyed window
    wedge(LABELS.ean13);
    expect(onScan).toHaveBeenCalledTimes(1);
    frozen.now.mockReturnValue(10_000 + REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED] + 50); // a deliberate second identical box
    wedge(LABELS.ean13);
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it("counting TEN identical boxes with a wedge counts ten -- under-counting is the worst cycle-count failure", () => {
    const frozen = { now: vi.fn() };
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={frozen} />);
    for (let box = 0; box < 10; box += 1) {
      frozen.now.mockReturnValue(50_000 + box * 400);
      wedge(LABELS.code128);
    }
    expect(onScan).toHaveBeenCalledTimes(10);
  });
});

// ────────────────────────────────────────────── the camera

describe("Camera: a decoder that reports the label on every frame", () => {
  let clock;
  let rafQueue;
  let detected;
  let stop;
  const deps = () => ({ now: () => clock, detectorFactory: async () => ({ detect: vi.fn(async () => detected) }) });

  beforeAll(() => {
    // jsdom's video element never becomes ready; the scan loop only decodes a frame once the video has data.
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  });
  beforeEach(() => {
    clock = 100_000;
    rafQueue = [];
    detected = [];
    stop = vi.fn();
    // Frames are driven by hand, so a test decides exactly what the decoder sees and when.
    vi.stubGlobal("requestAnimationFrame", (cb) => { rafQueue.push(cb); return rafQueue.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) };
  });

  /** Open the camera and wait for the scan loop to schedule its first frame. */
  async function openCamera(onScan) {
    render(<ScanInput onScan={onScan} deps={deps()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    await screen.findByRole("dialog", { name: /camera scanner/i });
    await waitFor(() => expect(rafQueue.length).toBeGreaterThan(0));
  }
  /** Run `n` frames, `frameMs` apart. */
  async function frames(n, frameMs = 16) {
    for (let i = 0; i < n; i += 1) {
      const cb = rafQueue.shift();
      if (!cb) return;
      clock += frameMs;
      await act(async () => { await cb(clock); });
    }
  }

  it.each(Object.entries({ ean13: LABELS.ean13, upcA: LABELS.upcA, code128: LABELS.code128, qrUrl: LABELS.qrUrl, qrJson: LABELS.qrJson }))(
    "a decoded %s label reaches the workflow as the value the decoder read", async (_name, label) => {
      const onScan = vi.fn();
      await openCamera(onScan);
      detected = [{ rawValue: label }];
      await frames(1);
      expect(onScan).toHaveBeenCalledTimes(1);
      expect(onScan).toHaveBeenCalledWith(label);
    },
  );

  it("a decoder's whitespace is trimmed exactly as a wedge's is (scenario 2: trimmed input resolves to the right Part)", async () => {
    const onScan = vi.fn();
    await openCamera(onScan);
    detected = [{ rawValue: `  ${LABELS.code128}\n` }];
    await frames(1);
    expect(onScan).toHaveBeenCalledWith(LABELS.code128);
  });

  it("one label held in frame for sixty frames is ONE scan, not sixty", async () => {
    const onScan = vi.fn();
    await openCamera(onScan);
    detected = [{ rawValue: LABELS.ean13 }];
    await frames(60, 16); // ~1s of video at 60fps, inside the camera's repeat window
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("the camera stays OPEN and a DIFFERENT label is a second scan -- a pallet is worked without reopening it", async () => {
    const onScan = vi.fn();
    await openCamera(onScan);
    detected = [{ rawValue: LABELS.ean13 }];
    await frames(3);
    detected = [{ rawValue: LABELS.upcA }];
    await frames(3);
    expect(onScan.mock.calls.map((c) => c[0])).toEqual([LABELS.ean13, LABELS.upcA]);
    expect(screen.getByRole("dialog", { name: /camera scanner/i })).toBeTruthy();
  });

  it("the camera's window is LONGER than the wedge's: the same label after the camera window is a new scan, inside it is not", async () => {
    expect(REPEAT_WINDOW_MS[SCAN_SOURCE.CAMERA]).toBeGreaterThan(REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED]);
    const onScan = vi.fn();
    await openCamera(onScan);
    detected = [{ rawValue: LABELS.code128 }];
    await frames(1);
    await frames(1, REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED] + 100); // past a wedge's window, still inside the camera's
    expect(onScan).toHaveBeenCalledTimes(1);
    await frames(1, REPEAT_WINDOW_MS[SCAN_SOURCE.CAMERA] + 100); // the label left and came back
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it("a frame with nothing decoded is normal and scans nothing", async () => {
    const onScan = vi.fn();
    await openCamera(onScan);
    detected = [];
    await frames(5);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("closing the camera stops the stream (a live stream behind a closed screen looks like recording)", async () => {
    await openCamera(vi.fn());
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(stop).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────── both inputs converge on one resolvable identity

describe("Wedge and camera converge: the boundary resolves WHAT a value is, whichever input produced it", () => {
  const catalog = { parts: [{ partId: "PRT-1001", sku: null }, { partId: "PRT-1002", sku: null }] };

  it.each(Object.entries({
    "a bare part code": LABELS.partCode,
    "a lowercase label": LABELS.partCodeLowercase,
    "a QR carrying JSON": LABELS.qrJson,
    "a QR carrying a URL": LABELS.qrUrl,
    "a vendor-prefixed code": LABELS.vendorPrefixed,
    "a wedge's padded code": `  ${LABELS.partCode}  `,
  }))("%s resolves to the same Part", (_name, value) => {
    const r = resolveScannedIdentity(value, catalog);
    expect(r.resolutionState).toBe(SCAN_RESOLUTION.RESOLVED);
    expect([r.entityType, r.entityId]).toEqual(["PART", "PRT-1001"]);
  });

  it("an unregistered barcode is NOT_FOUND, never a guess -- the server's alias lookup is what turns a barcode into a Part", () => {
    for (const barcode of [LABELS.ean13, LABELS.upcA, LABELS.code128]) {
      const r = resolveScannedIdentity(barcode, catalog);
      expect(r.resolutionState).toBe(SCAN_RESOLUTION.NOT_FOUND);
      expect(r.entityId).toBeNull();
    }
  });

  it("nothing usable is INVALID, never NOT_FOUND: nothing scanned differs from nothing found", () => {
    for (const blank of ["", "   ", null, undefined]) {
      expect(resolveScannedIdentity(blank, catalog).resolutionState).toBe(SCAN_RESOLUTION.INVALID);
    }
    expect(normalizeScanToken("   ")).toBeNull();
  });

  it("two Parts whose codes differ only by case are AMBIGUOUS, never silently picked", () => {
    const r = resolveScannedIdentity("prt-1001", { parts: [{ partId: "PRT-1001" }, { partId: "prt-1001" }] });
    expect(r.resolutionState).toBe(SCAN_RESOLUTION.AMBIGUOUS);
  });
});
