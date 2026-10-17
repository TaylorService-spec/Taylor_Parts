// RETURN INTAKE BY SCAN -- the surface for an authority that was deployed and unreachable.
//
// ============================ WHY THIS EXISTS ============================
//
// `recordReturnIntake` has been deployed, activated in the sandbox and granted to the warehouse
// manager since the promotion. There was no way to reach it. A capability nobody can exercise is not
// a feature, and "deployed" had quietly been standing in for "usable".
//
// ============================ WHAT IT MUST NEVER BECOME ============================
//
// DECISIONS #118: intake and disposition are SEPARATE authorities, and a return must never
// automatically restore inventory to sellable stock.
//
// The risk on a screen like this is not a bug, it is a helpful-seeming control. A "return to stock"
// button, a condition that routes somewhere, a default that quietly means "fine, put it back" --
// each would decide a policy nobody has made. So the tests below spend as much effort on what is
// ABSENT as on what works.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import ReturnIntakeScan, { RETURN_CONDITIONS } from "../src/modules/scan/ReturnIntakeScan.jsx";

afterEach(cleanup);

let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };

// EOS (Firebase exit F7a): the screen asks the server which companies and warehouses the caller may name. One company is the
// common case and is chosen for them; the multi-company cases below choose explicitly.
const ONE_COMPANY = { companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }],
  warehouses: [{ warehouseId: "WH-PHX", name: "Phoenix", operatingCompanyId: "taylor" }] };
const mount = (over = {}) => {
  const recordReturnIntake = over.recordReturnIntake
    ?? vi.fn().mockResolvedValue({ outcome: "recorded", returnId: "ret_1", partId: "PRT-1001", state: "AWAITING_DISPOSITION", quantity: 1 });
  const listReturnIntakeOptions = over.listReturnIntakeOptions ?? vi.fn().mockResolvedValue(ONE_COMPANY);
  render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake, listReturnIntakeOptions }, scanInputDeps: { now: advancingClock },
    ...(over.cacheOwner !== undefined ? { cacheOwner: over.cacheOwner } : {}) }} />);
  return recordReturnIntake;
};
/** Let the options read settle, then press Record. */
const recordIt = async () => {
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /record this return/i })); });
};

const scanPart = (code = "PRT-1001") => {
  fireEvent.change(screen.getByLabelText(/scan returned part/i), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
};
const choose = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// ═══════════════════════════════════════════ the journey

describe("taking a return in", () => {
  it("starts by scanning the part, not by filling in a form", () => {
    mount();
    expect(screen.getByLabelText(/scan returned part/i)).toBeTruthy();
    // Nothing else is asked until the system knows what it is looking at.
    expect(screen.queryByLabelText(/what condition/i)).toBeNull();
  });

  it("records through the EXISTING governed command once a condition is observed", async () => {
    const record = mount();
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    await recordIt();
    const payload = record.mock.calls[0][0];
    expect(payload.partId).toBe("PRT-1001");
    expect(payload.condition).toBe("OPENED");
    expect(payload.quantity).toBe(1);
    expect(typeof payload.idempotencyKey).toBe("string");
  });

  it("omits an empty reference rather than storing a blank fact", async () => {
    const record = mount();
    scanPart();
    choose(/what condition is it in/i, "UNOPENED");
    await recordIt();
    expect(record.mock.calls[0][0]).not.toHaveProperty("sourceReference");
  });
});

// ═══════════════════════════════════════════ condition is an observation

describe("condition", () => {
  it("HAS NO DEFAULT -- a pre-selected condition is one nobody observed", () => {
    mount();
    scanPart();
    expect(screen.getByLabelText(/what condition is it in/i).value).toBe("");
    expect(screen.getByRole("button", { name: /record this return/i }).disabled).toBe(true);
  });

  it("says why it cannot be chosen for them", () => {
    mount();
    scanPart();
    expect(screen.getByText(/it is an observation, so nobody can choose it for you/i)).toBeTruthy();
  });

  it("offers the server's closed set verbatim, including an explicit CANNOT TELL", () => {
    // UNKNOWN is a real observation meaning "nobody could tell" -- distinct from not having looked,
    // which is why it is a choice rather than the default. An unrecognised value is refused by the
    // command rather than coerced, so the list here must not drift from the server's.
    mount();
    scanPart();
    const values = [...screen.getByLabelText(/what condition is it in/i).querySelectorAll("option")]
      .map((o) => o.value).filter((v) => v !== "");
    expect(values.sort()).toEqual(RETURN_CONDITIONS.map((c) => c.value).sort());
    expect(values).toContain("UNKNOWN");
  });
});

// ═══════════════════════════════════════════ #118, on the screen

describe("a return does not go back on the shelf", () => {
  it("the confirmation says AWAITING DISPOSITION and that counts are unchanged", async () => {
    mount();
    scanPart();
    choose(/what condition is it in/i, "DAMAGED");
    await recordIt();
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/awaiting a disposition decision/i);
    expect(notice.textContent).toMatch(/not.*gone back into sellable stock/i);
    expect(notice.textContent).toMatch(/stock counts are unchanged/i);
  });

  it("says so BEFORE recording too, not only afterwards", () => {
    mount();
    expect(screen.getByText(/does not put anything back into sellable stock/i)).toBeTruthy();
  });

  it("OFFERS NO DISPOSITION CONTROL OF ANY KIND", () => {
    // The helpful-seeming button that would cross #118. None of these may exist.
    mount();
    scanPart();
    for (const forbidden of [/return to stock/i, /restock/i, /scrap/i, /quarantine/i, /dispose/i, /accept back/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════ refusals stay refusals

describe("when the server refuses", () => {
  it("a permission denial is named as one, not shown as a failure to save", async () => {
    const record = vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "permission-denied" }));
    mount({ recordReturnIntake: record });
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    await recordIt();
    expect((await screen.findByRole("alert")).textContent).toMatch(/not authorized/i);
  });

  it("a rejected return says nothing was changed", async () => {
    const record = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "internal" }));
    mount({ recordReturnIntake: record });
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    await recordIt();
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was changed/i);
  });
});

// ═══════════════════════════════════════════ replay safety

describe("recording another return", () => {
  it("uses a NEW idempotency key, so the next return is not a replay of the last", async () => {
    const record = mount();
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    await recordIt();
    fireEvent.click(await screen.findByRole("button", { name: /take another return/i }));

    scanPart("PRT-2002");
    choose(/what condition is it in/i, "DAMAGED");
    await recordIt();

    const [first, second] = record.mock.calls.map((c) => c[0]);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.partId).toBe("PRT-2002");
  });
});

// ═══════════════════════════════════════════ company and warehouse (EOS, Owner ruling F7a)

describe("which company is taking it in", () => {
  const TWO = { companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }, { operatingCompanyId: "ventana", operatingCompanyKey: "VENTANA" }],
    warehouses: [{ warehouseId: "WH-PHX", name: "Phoenix", operatingCompanyId: "taylor" }, { warehouseId: "WH-TUS", name: "Tucson", operatingCompanyId: "ventana" }] };

  it("one company is chosen for them, and the request names it; no warehouse unless one is chosen", async () => {
    const record = mount();
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    await recordIt();
    expect(record.mock.calls[0][0].operatingCompanyId).toBe("taylor");
    expect(record.mock.calls[0][0]).not.toHaveProperty("warehouseId");
  });

  it("with several companies NOBODY GUESSES: Record waits for a choice, and the warehouses follow the company", async () => {
    const record = mount({ listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    expect(screen.getByRole("button", { name: /record this return/i }).disabled).toBe(true);
    expect(screen.getByText(/choose the company taking it in/i)).toBeTruthy();
    choose(/which company is taking it in/i, "ventana");
    const warehouses = [...screen.getByLabelText(/receiving warehouse/i).querySelectorAll("option")].map((o) => o.value);
    expect(warehouses).toEqual(["", "WH-TUS"]);
    choose(/receiving warehouse/i, "WH-TUS");
    await recordIt();
    expect(record.mock.calls[0][0]).toMatchObject({ operatingCompanyId: "ventana", warehouseId: "WH-TUS" });
  });

  it("no company authority is said in words, and nothing can be recorded", async () => {
    const refused = Object.assign(new Error("no"), { code: "permission-denied", details: { code: "COMPANY_AUTHORITY_REQUIRED" } });
    mount({ listReturnIntakeOptions: vi.fn().mockRejectedValue(refused) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/no operating company to take returns in for/i);
  });

  it("OFFLINE, THIS user's last server answer is used; a refusal is never answered from the cache", async () => {
    // Online once as u-1: the answer is kept under u-1.
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    cleanup();
    const offline = Object.assign(new Error("offline"), { code: "unavailable" });
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    await act(async () => {});
    expect([...screen.getByLabelText(/which company is taking it in/i).querySelectorAll("option")].map((o) => o.value))
      .toEqual(["", "taylor", "ventana"]);
    cleanup();
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "permission-denied" })) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/not authorized/i);
    globalThis.localStorage.clear();
  });

  it("SHARED DEVICE: another user, or no signed-in identity, never sees a cached answer (keyed by principal)", async () => {
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    cleanup();
    const offline = Object.assign(new Error("offline"), { code: "unavailable" });
    mount({ cacheOwner: "u-2", listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be recorded/i);
    expect(screen.queryByLabelText(/which company is taking it in/i)).toBeNull();
    cleanup();
    mount({ listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be recorded/i);
    // Nothing at all is kept for an anonymous caller.
    globalThis.localStorage.clear();
    mount({ listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    expect(Object.keys(globalThis.localStorage)).toEqual([]);
    globalThis.localStorage.clear();
  });
});
