// ADD EXISTING UNIT — the composition, at the render (vitest + jsdom).
//
// The pure suite (serializedAssetAcquire.test.mjs) proves what the request may contain and how a
// replay must be read. What only a render can prove is what a PERSON is looking at, and this surface
// was reported for exactly that: three fields compressed onto one line, a chosen company location
// sitting directly above the sentence "the company locations could not be read", and one validation
// message printed twice.
//
// THE LOCATION CONTRADICTION WAS A REAL BUG, not an aesthetic one. The dialog compared
// `status !== "READY"` while the governed transport returns `RECEIVING_OUTCOME.READY`, which is the
// lowercase `"ready"` — so EVERY successful read rendered the failure sentence beside the options it
// had just loaded. The tests below fix the states in place so that particular class of miss cannot
// come back unnoticed.
//
// Every hook is mocked (no Firebase, no network) so each state can be driven directly.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";

vi.mock("../src/hooks/useSerialTrackedParts", async (orig) => {
  const actual = await orig();
  return { ...actual, useSerialTrackedParts: vi.fn() };
});

import { SERIAL_PARTS_STATUS } from "../src/hooks/useSerialTrackedParts";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";
import { ACQUIRE_REASON } from "../src/domain/serializedAssetAcquireVocabulary.js";
import AcquireExistingUnit from "../src/modules/receiving/AcquireExistingUnit.jsx";

const PARTS = {
  status: SERIAL_PARTS_STATUS.READY,
  options: [
    { value: "part_c712", label: "Taylor C712 — Soft Serve Freezer" },
    { value: "part_c723", label: "Taylor C723 — Twin Twist" },
  ],
};

const LOCATIONS = [
  { value: "wh_main", label: "Main Distribution Center" },
  { value: "wh_south", label: "South Depot" },
];

/** Mount with everything READY unless a case says otherwise. */
function mount(overrides = {}) {
  const useParts = () => overrides.parts ?? PARTS;
  return render(
    <AcquireExistingUnit
      canAcquire={overrides.canAcquire ?? true}
      locationOptions={overrides.locationOptions ?? LOCATIONS}
      locationsStatus={"locationsStatus" in overrides ? overrides.locationsStatus : RECEIVING_OUTCOME.READY}
      onClose={overrides.onClose ?? (() => {})}
      onAcquired={overrides.onAcquired ?? (() => {})}
      onRetryLocations={overrides.onRetryLocations}
      deps={{ useParts, callAcquire: overrides.callAcquire ?? (async () => ({})) }}
    />,
  );
}

/** Fill every governed fact. */
function completeForm() {
  fireEvent.change(screen.getByLabelText("Part"), { target: { value: "part_c712" } });
  fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: "GATE-ND33-DO-NOT-DELETE" } });
  fireEvent.change(screen.getByLabelText("Company location"), { target: { value: "wh_main" } });
  fireEvent.click(screen.getByRole("radio", { name: /Opening balance/ }));
}

afterEach(cleanup);

// ─────────────────────────────── 1–2. THE FORM IS A COLUMN ───────────────────────────────

describe("the form is a single governed column", () => {
  it("renders Part, Serial number, Company location, Reason and Provenance note in that order", () => {
    const { container } = mount();
    const order = [...container.querySelectorAll("[data-acquire-field]")]
      .map((node) => node.getAttribute("data-acquire-field"));
    expect(order).toEqual([
      "acquire-part",
      "acquire-serial",
      "acquire-location",
      "reason",
      "acquire-note",
    ]);
  });

  it("stacks each field rather than composing them as one compressed inline row", () => {
    const { container } = mount();
    const fields = [...container.querySelectorAll("[data-acquire-field]")];
    // THE ACTUAL DEFECT, held in place. The fields used to be bare inline <label> elements inside a
    // panel with no form grammar, so the browser flowed Part, Serial and Company location onto one
    // line. Each is now its own block-level field carrying the stacked-column class, and every
    // control is full-width rather than shrink-to-fit.
    expect(fields.length).toBe(5);
    for (const field of fields) {
      expect(field.className).toContain("fo-form-field");
      expect(field.tagName).not.toBe("LABEL");
    }
    for (const control of container.querySelectorAll("select, input[type='text']")) {
      expect(control.className).toContain("fo-wizard-control");
    }
  });

  it("renders no raw identifier as a user-facing label", () => {
    const { container } = mount();
    const text = container.textContent;
    // Part and warehouse ids are the option VALUES; a person reads business names.
    expect(text).toContain("Taylor C712 — Soft Serve Freezer");
    expect(text).toContain("Main Distribution Center");
    expect(text).not.toContain("part_c712");
    expect(text).not.toContain("wh_main");
    // And no stored reason token where a business word belongs.
    for (const token of Object.values(ACQUIRE_REASON)) {
      expect(text).not.toContain(token);
    }
  });
});

// ─────────────────────────────── 3. REASON IS THREE CONTROLS ───────────────────────────────

describe("reason", () => {
  it("renders as three distinct stacked controls, each with its own meaning", () => {
    const { container } = mount();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    // Not a run-on sentence: each option carries its label and its hint as separate elements.
    for (const option of container.querySelectorAll("[data-acquire-reason]")) {
      expect(within(option).getByRole("radio")).toBeTruthy();
      expect(option.querySelector(".fo-acquire__reason-label")?.textContent).toBeTruthy();
      expect(option.querySelector(".fo-acquire__reason-hint")?.textContent).toBeTruthy();
    }
    expect(screen.getByRole("radio", { name: /Opening balance/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Legacy migration/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Existing company asset/ })).toBeTruthy();
    // No default. There is no reason that would be true by omission.
    expect(radios.every((radio) => !radio.checked)).toBe(true);
  });
});

// ─────────────────────────────── 4–6. THE LOCATION STATES ───────────────────────────────

describe("company location states are truthful and mutually exclusive", () => {
  it("READY offers the governed options and says nothing about failure", () => {
    const { container } = mount();
    const picker = screen.getByLabelText("Company location");
    expect(picker.disabled).toBe(false);
    expect(picker.querySelectorAll("option")).toHaveLength(3); // placeholder + two warehouses
    expect(container.querySelector("[data-acquire-location-message]")).toBeNull();
    expect(container.textContent).not.toContain("could not be loaded");
  });

  it("ERROR has no selected or default location beside its failure message", async () => {
    // Choose a location while the read is READY, then have the read fail.
    const view = mount();
    fireEvent.change(screen.getByLabelText("Company location"), { target: { value: "wh_main" } });
    expect(screen.getByLabelText("Company location").value).toBe("wh_main");

    view.rerender(
      <AcquireExistingUnit
        canAcquire
        locationOptions={LOCATIONS}
        locationsStatus={RECEIVING_OUTCOME.UNAVAILABLE}
        onClose={() => {}}
        onAcquired={() => {}}
        deps={{ useParts: () => PARTS, callAcquire: async () => ({}) }}
      />,
    );

    // THE CRITICAL INVARIANT. A value nothing currently vouches for is not a default worth keeping.
    const picker = screen.getByLabelText("Company location");
    expect(picker.value).toBe("");
    expect(picker.disabled).toBe(true);
    expect(picker.querySelectorAll("option[value]:not([value=''])")).toHaveLength(0);
    expect(screen.getByText("Company locations could not be loaded.")).toBeTruthy();
  });

  it("keeps EMPTY, DENIED, ERROR and LOADING as four different answers", () => {
    const say = (status) => {
      cleanup();
      const { container } = mount({
        locationsStatus: status,
        locationOptions: status === RECEIVING_OUTCOME.READY ? [] : LOCATIONS,
      });
      return container.querySelector("[data-acquire-location-message]")?.textContent ?? null;
    };
    // A successful read that found nothing is a fact about the business, not a fault.
    expect(say(RECEIVING_OUTCOME.READY)).toBe("No eligible company locations are available.");
    expect(say(RECEIVING_OUTCOME.DENIED)).toBe(
      "You are not able to read company locations, so none can be chosen.",
    );
    expect(say(RECEIVING_OUTCOME.UNAVAILABLE)).toBe("Company locations could not be loaded.");
    expect(say(null)).toBe("Loading company locations…");
    // All four disable the picker, so none of them can leave a choosable stale value.
    for (const status of [RECEIVING_OUTCOME.DENIED, RECEIVING_OUTCOME.UNAVAILABLE, null]) {
      cleanup();
      mount({ locationsStatus: status });
      expect(screen.getByLabelText("Company location").disabled).toBe(true);
    }
  });

  it("offers Retry only where trying again could change the answer", () => {
    const onRetryLocations = vi.fn();
    mount({ locationsStatus: RECEIVING_OUTCOME.UNAVAILABLE, onRetryLocations });
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    cleanup();
    // DENIED will refuse identically forever; a Retry there teaches a person to keep pressing.
    mount({ locationsStatus: RECEIVING_OUTCOME.DENIED, onRetryLocations });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

// ─────────────────────────────── 7–8. VALIDATION, ONCE EACH ───────────────────────────────

describe("validation", () => {
  it("renders each field's message exactly once, and not before the field is used", () => {
    const { container } = mount();
    const reasonCopy = "Say why this unit is being added without a purchase.";

    // A FIELD IS NOT WRONG BEFORE IT HAS BEEN VISITED. Four messages on the first frame opened this
    // dialog in red, about a form nobody had touched.
    expect(container.querySelectorAll("[data-acquire-problem]")).toHaveLength(0);

    // Used and left incomplete, each field says its own piece — exactly once.
    fireEvent.blur(screen.getByLabelText("Part"));
    fireEvent.blur(screen.getByLabelText("Serial number"));
    fireEvent.blur(screen.getByLabelText("Company location"));
    // Moving PAST the reason group is what makes skipping it answerable — a radio group with no
    // default is only ever "used" by choosing one, which is the act that resolves it.
    fireEvent.blur(screen.getByLabelText(/Provenance note/));

    const messages = [...container.querySelectorAll("[role='alert']")].map((n) => n.textContent);
    // The duplicate this surface was reported for: the same sentence beside the field AND again
    // under the disabled button.
    expect(messages.filter((m) => m === reasonCopy)).toHaveLength(1);
    expect(container.textContent.split(reasonCopy).length - 1).toBe(1);
    expect(container.querySelector("[data-acquire-problem='acquire-part']")?.textContent)
      .toBe("Choose the part this unit is.");
    // Every problem appears against its own field, and no problem appears twice.
    const ids = [...container.querySelectorAll("[data-acquire-problem]")]
      .map((n) => n.getAttribute("data-acquire-problem"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the outstanding facts beside the unavailable action, in different words", async () => {
    const { container } = mount();
    const blocking = () => container.querySelector("[data-acquire-blocking]")?.textContent ?? null;

    // Not a grey button with nothing to read: what is missing is said out loud, as things.
    expect(blocking()).toBe(
      "Still needed: the part, the serial number, the company location and a reason.",
    );
    expect(screen.getByRole("button", { name: "Review acquisition" }).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Part"), { target: { value: "part_c712" } });
    fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: "SN-1" } });
    expect(blocking()).toBe("Still needed: the company location and a reason.");

    completeForm();
    // Once nothing is outstanding, the explanation goes away rather than lingering.
    expect(blocking()).toBeNull();
    expect(screen.getByRole("button", { name: "Review acquisition" }).disabled).toBe(false);
  });
});

// ─────────────────────────────── 9–11. REVIEW, THEN CONFIRM ───────────────────────────────

describe("the two stages", () => {
  it("reaches the confirmation only when every governed fact exists, and calls nothing to get there", async () => {
    const callAcquire = vi.fn(async () => ({}));
    mount({ callAcquire });
    completeForm();
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));

    expect(screen.getByRole("heading", { name: "Confirm acquisition" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm acquisition" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    // NOTHING IS WRITTEN TO REACH THE READ-BACK. Review assembles; only Confirm commits.
    expect(callAcquire).not.toHaveBeenCalled();
  });

  it("reads the governed facts back, in business words", async () => {
    const { container } = mount();
    completeForm();
    fireEvent.change(screen.getByLabelText(/Provenance note/), { target: { value: "Found in the Broadway van" } });
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));

    const read = (key) => container.querySelector(`[data-acquire-confirm='${key}']`)?.textContent;
    expect(read("part")).toBe("Taylor C712 — Soft Serve Freezer");
    expect(read("serial")).toBe("GATE-ND33-DO-NOT-DELETE");
    expect(read("location")).toBe("Main Distribution Center");
    expect(read("reason")).toBe("Opening balance");
    expect(read("note")).toBe("Found in the Broadway van");
    // The consequence is stated where the irreversible press is, not left on the previous screen.
    expect(container.textContent).toContain("without a purchase or receiving record");
  });

  it("sends the command's own payload and nothing else", async () => {
    const callAcquire = vi.fn(async () => ({}));
    mount({ callAcquire });
    completeForm();
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm acquisition" }));

    expect(callAcquire).toHaveBeenCalledTimes(1);
    const [request] = callAcquire.mock.calls[0];
    // THE PAYLOAD IS UNCHANGED BY THIS WORK. The validator refuses any field outside its
    // allow-list, so an extra key would fail the whole request rather than being ignored.
    expect(Object.keys(request).sort()).toEqual(
      ["idempotencyKey", "locationId", "partId", "reason", "serialNo"],
    );
    expect(request.partId).toBe("part_c712");
    expect(request.serialNo).toBe("GATE-ND33-DO-NOT-DELETE");
    expect(request.locationId).toBe("wh_main");
    expect(request.reason).toBe(ACQUIRE_REASON.OPENING_BALANCE);
  });

  it("Back returns to the form with every answer intact", async () => {
    mount();
    completeForm();
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("heading", { name: "Add existing unit" })).toBeTruthy();
    expect(screen.getByLabelText("Part").value).toBe("part_c712");
    expect(screen.getByLabelText("Serial number").value).toBe("GATE-ND33-DO-NOT-DELETE");
    expect(screen.getByLabelText("Company location").value).toBe("wh_main");
    expect(screen.getByRole("radio", { name: /Opening balance/ }).checked).toBe(true);
  });
});

// ─────────────────────────────── 12. SUCCESS CANNOT FIRE TWICE ───────────────────────────────

describe("the success state", () => {
  const ACQUIRED = { outcome: { outcome: "acquired", serializedAssetId: "sa_1" } };

  it("says the unit is on the books and leaves nothing to press again", async () => {
    const callAcquire = vi.fn(async () => ACQUIRED);
    mount({ callAcquire });
    completeForm();
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm acquisition" }));

    expect(await screen.findByText("Added to company inventory.")).toBeTruthy();
    // NOT MERELY DISABLED — GONE. A surface that still looks armed after it has fired is how
    // somebody comes to press it twice. The replay would be governed and harmless; the confusion
    // would not be.
    expect(screen.queryByRole("button", { name: "Confirm acquisition" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review acquisition" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(callAcquire).toHaveBeenCalledTimes(1);
  });

  it("presents a replay as the success it is", async () => {
    mount({ callAcquire: async () => ({ outcome: { outcome: "replayed", serializedAssetId: "sa_1" } }) });
    completeForm();
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm acquisition" }));

    expect(await screen.findByText(/already on the books/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm acquisition" })).toBeNull();
  });
});
