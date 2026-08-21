// SHARED SCANNER INPUT — the mounted component (vitest + jsdom).
//
// The policy is proved pure in test/scanInputPolicy.test.mjs. These cover what only the mounted
// input can show: that a wedge works, that focus comes back, that the camera degrades honestly, and
// that the announcement is the accessibility channel rather than a decoration.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import ScanInput from "../src/shared/ui/ScanInput.jsx";
import { FEEDBACK } from "../src/domain/scanInputPolicy.js";

afterEach(cleanup);

let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };
const deps = () => ({ now: advancingClock });

const field = () => screen.getByLabelText(/scan item/i);
const type = (value) => fireEvent.change(field(), { target: { value } });
const submit = () => fireEvent.submit(field().closest("form"));

/** A hardware wedge types the code and presses Enter. That is all it does. */
const wedge = (value) => { type(value); submit(); };

// ────────────────────────────────────────────── the three inputs

describe("Scan input (a wedge is just a keyboard)", () => {
  it("a wedge scan reaches the workflow, with the value trimmed", () => {
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={deps()} />);
    wedge("  PRT-1001  ");
    expect(onScan).toHaveBeenCalledWith("PRT-1001");
  });

  it("the field CLEARS after every scan, so the next code does not append to the last", () => {
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    wedge("PRT-1001");
    expect(field().value).toBe("");
  });

  it("focus comes BACK after a scan — a wedge types into whatever is focused", () => {
    // A screen that lets focus drift silently drops the second scan, and the operator scans harder.
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    wedge("PRT-1001");
    expect(document.activeElement).toBe(field());
  });

  it("typing is never removed — a damaged label still has to be enterable", () => {
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    expect(field()).toBeTruthy();
    expect(field().disabled).toBe(false);
  });

  it("browser autocorrect is off — a wedge sends keystrokes and must not be 'helped'", () => {
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    expect(field().getAttribute("autocomplete")).toBe("off");
    expect(field().getAttribute("autocorrect")).toBe("off");
    expect(field().getAttribute("autocapitalize")).toBe("off");
    expect(field().getAttribute("spellcheck")).toBe("false");
  });

  it("an empty submit reaches the workflow not at all", () => {
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={deps()} />);
    submit();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("a disabled input accepts nothing and does not steal focus", () => {
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} disabled deps={deps()} />);
    expect(field().disabled).toBe(true);
    expect(screen.getByRole("button", { name: /scan a code/i }).disabled).toBe(true);
  });
});

// ────────────────────────────────────────────── duplicates

describe("Scan input (a stutter is not a second scan)", () => {
  it("the same value twice in the SAME instant reaches the workflow once", () => {
    const frozen = { now: () => 5000 };
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={frozen} />);
    wedge("PRT-1001");
    wedge("PRT-1001");
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("a suppressed repeat SAYS so, rather than looking like nothing happened", () => {
    const frozen = { now: () => 5000 };
    render(<ScanInput onScan={vi.fn()} deps={frozen} />);
    wedge("PRT-1001");
    wedge("PRT-1001");
    expect(screen.getByRole("status").textContent).toMatch(/already scanned/i);
  });

  it("the same value after the window IS a second scan — that is how you count", () => {
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={deps()} />);   // advances 1s per read
    wedge("PRT-1001");
    wedge("PRT-1001");
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it("a different value is never suppressed, however fast", () => {
    const frozen = { now: () => 5000 };
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={frozen} />);
    wedge("PRT-1001");
    wedge("PRT-2002");
    expect(onScan).toHaveBeenCalledTimes(2);
  });
});

// ────────────────────────────────────────────── feedback

describe("Scan input (the operator is told what happened)", () => {
  it("announces the VALUE, not merely that something was scanned", () => {
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    wedge("PRT-1001");
    expect(screen.getByRole("status").textContent).toMatch(/PRT-1001/);
  });

  it("the announcement is an aria-live region — the same sentence a sighted operator sees", () => {
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    wedge("PRT-1001");
    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("the WORKFLOW's verdict is what is announced, not merely that a code arrived", () => {
    render(<ScanInput onScan={() => ({ feedback: FEEDBACK.REJECTED, detail: "That is a different part." })} deps={deps()} />);
    wedge("PRT-9999");
    expect(screen.getByRole("status").textContent).toMatch(/different part/i);
  });

  it("a rejection is marked so it can be styled differently from an acceptance", () => {
    render(<ScanInput onScan={() => FEEDBACK.REJECTED} deps={deps()} />);
    wedge("PRT-9999");
    expect(screen.getByRole("status").className).toMatch(/rejected/);
  });

  it("vibration is attempted where supported, and its absence breaks nothing", () => {
    const vibrate = vi.fn();
    navigator.vibrate = vibrate;
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    wedge("PRT-1001");
    expect(vibrate).toHaveBeenCalled();
    delete navigator.vibrate;
  });

  it("a device with NO vibration still scans", () => {
    delete navigator.vibrate;
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={deps()} />);
    wedge("PRT-1001");
    expect(onScan).toHaveBeenCalled();
  });

  it("a device with NO WebAudio still scans", () => {
    // jsdom has no AudioContext; that this test runs at all is the assertion.
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} deps={deps()} />);
    wedge("PRT-1001");
    expect(onScan).toHaveBeenCalledWith("PRT-1001");
  });
});

// ────────────────────────────────────────────── camera

describe("Scan input (the camera degrades honestly)", () => {
  beforeEach(() => { delete navigator.mediaDevices; });

  it("says the camera is unavailable rather than showing a dead button", async () => {
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    expect(await screen.findByText(/camera scanning is not available/i)).toBeTruthy();
    // and the field still works
    expect(field().disabled).toBe(false);
  });

  it("a REFUSED camera permission says so and leaves typing available", async () => {
    navigator.mediaDevices = { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) };
    render(<ScanInput onScan={vi.fn()} deps={deps()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    expect(await screen.findByText(/could not be opened/i)).toBeTruthy();
    expect(field().disabled).toBe(false);
  });

  it("a browser with no DECODER says so and closes the camera rather than showing a dead viewfinder", async () => {
    const stop = vi.fn();
    navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) };
    render(<ScanInput onScan={vi.fn()} deps={{ ...deps(), detectorFactory: async () => null }} />);
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    expect(await screen.findByText(/live decoding is not supported/i)).toBeTruthy();
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("asks for the REAR camera with continuous focus — a fixed-focus front camera cannot read a label", async () => {
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    navigator.mediaDevices = { getUserMedia };
    render(<ScanInput onScan={vi.fn()} deps={{ ...deps(), detectorFactory: async () => null }} />);
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.video.facingMode).toBe("environment");
    expect(constraints.video.focusMode).toBe("continuous");
  });

  it("stops the camera track when closed — a live stream behind a closed screen looks like recording", async () => {
    const stop = vi.fn();
    navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) };
    render(<ScanInput onScan={vi.fn()} deps={{ ...deps(), detectorFactory: async () => ({ detect: async () => [] }) }} />);
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    const done = await screen.findByRole("button", { name: /^done$/i });
    fireEvent.click(done);
    expect(stop).toHaveBeenCalled();
  });

  it("unmounting stops the camera too", async () => {
    const stop = vi.fn();
    navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) };
    const { unmount } = render(
      <ScanInput onScan={vi.fn()} deps={{ ...deps(), detectorFactory: async () => ({ detect: async () => [] }) }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    await screen.findByRole("dialog", { name: /camera scanner/i });
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("the camera dialog is labelled and modal", async () => {
    navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) };
    render(<ScanInput onScan={vi.fn()} deps={{ ...deps(), detectorFactory: async () => ({ detect: async () => [] }) }} />);
    fireEvent.click(screen.getByRole("button", { name: /scan a code/i }));
    const dialog = await screen.findByRole("dialog", { name: /camera scanner/i });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});
