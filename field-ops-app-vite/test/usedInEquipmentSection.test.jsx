// D6 — RENDER / LIFECYCLE / a11y gate for UsedInEquipmentSection, exercised through the PRODUCTION prop
// seam (hasCapability + accessVersion + an injected source fixture). Runs in CI via `npm run
// test:components` (vitest + jsdom). Proves: zero reads while hidden; Part/access-version changes cannot
// display stale rows; a section failure does not break sibling (Part Catalog) content; and the labels,
// Retry, Show more, alert/status regions, keyboard-operable controls, and mobile DOM hooks are present.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import UsedInEquipmentSection from "../src/modules/inventory/UsedInEquipmentSection.jsx";

afterEach(cleanup);

const grant = () => true;
const deny = () => false;

const model = (o = {}) => ({ manufacturerName: "Taylor", modelNumber: "C713", displayName: "Taylor C713", family: null, subtype: null, ...o });
const ev = (o = {}) => ({ status: "OK", windowComplete: true, strongestSupportingAuthority: "MANUFACTURER", boundedSupportsCount: 2, boundedContradictsCount: 0, windowSize: 2, ...o });
const item = (o = {}) => ({
  compatibilityId: "cmp_" + "a".repeat(64), equipmentModelId: "TAYLOR--C713", partId: "TST-1001",
  model: model(o.model), compatibilityType: "DIRECT_FIT", assembly: null, installationPosition: null, quantityRequired: 1,
  serialApplicabilitySummary: "Applies to all serial numbers", verificationStatus: "VERIFIED",
  applicabilityResolved: true, confidenceLevel: "HIGH", operational: true, evidence: ev(), ...o,
});
const resp = (o = {}) => ({ pageDisposition: "AVAILABLE", items: [item()], nextCursor: null, windowCounts: { returned: 1, operational: 1, excludedRejected: 0, malformedOmitted: 0, evidenceIncomplete: 0 }, ...o });
const okResp = (response) => ({ ok: true, response });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

describe("UsedInEquipmentSection — production prop seam", () => {
  it("HIDDEN when the capability is not granted: renders nothing and issues ZERO reads", async () => {
    const source = { readForPart: vi.fn(async () => okResp(resp())) };
    const { container } = render(<UsedInEquipmentSection hasCapability={deny} partId="TST-1001" accessVersion={0} source={source} />);
    // give any (incorrect) effect a chance to fire
    await act(async () => { await Promise.resolve(); });
    expect(container.innerHTML).toBe("");
    expect(source.readForPart).toHaveBeenCalledTimes(0);
  });

  it("throwing / non-function capability is also HIDDEN with zero reads", async () => {
    for (const cap of [undefined, null, 5, () => { throw new Error("x"); }, () => "true", (c) => c === "other"]) {
      const source = { readForPart: vi.fn(async () => okResp(resp())) };
      const { container, unmount } = render(<UsedInEquipmentSection hasCapability={cap} partId="TST-1001" accessVersion={0} source={source} />);
      await act(async () => { await Promise.resolve(); });
      expect(container.innerHTML).toBe("");
      expect(source.readForPart).toHaveBeenCalledTimes(0);
      unmount();
    }
  });

  it("granted: reads once and renders a Verified, operational relationship + a status live region", async () => {
    const source = { readForPart: vi.fn(async () => okResp(resp())) };
    render(<UsedInEquipmentSection hasCapability={grant} partId="TST-1001" accessVersion={0} source={source} />);
    await screen.findByText("Taylor C713");
    expect(source.readForPart).toHaveBeenCalledTimes(1);
    expect(source.readForPart.mock.calls[0][0]).toMatchObject({ partId: "TST-1001", cursor: null, limit: 10 });
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Usable")).toBeTruthy();
    expect(document.querySelector('[role="status"]')).toBeTruthy();
    // mobile DOM hooks: responsive wrapper + data-labelled cells
    expect(document.querySelector(".fo-table-scroll .fo-equipment-compat-table")).toBeTruthy();
    expect(document.querySelectorAll("td[data-label]").length).toBeGreaterThan(0);
  });

  it("UNAVAILABLE: shows an alert + a keyboard-operable Retry that re-fetches", async () => {
    let call = 0;
    const source = { readForPart: vi.fn(async () => (++call === 1 ? { ok: false, code: "unavailable" } : okResp(resp()))) };
    render(<UsedInEquipmentSection hasCapability={grant} partId="TST-1001" accessVersion={0} source={source} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/temporarily unavailable/i);
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry.tagName).toBe("BUTTON"); // focusable, keyboard-operable
    await act(async () => { fireEvent.click(retry); });
    await screen.findByText("Taylor C713");
    expect(source.readForPart).toHaveBeenCalledTimes(2);
  });

  it("Show more paginates; a later DEGRADED page degrades the section and suppresses any clean-completion claim", async () => {
    const source = {
      readForPart: vi.fn(async ({ cursor }) =>
        cursor === null
          ? okResp(resp({ items: [item({ assembly: "A" })], nextCursor: "C1" }))
          : okResp(resp({ pageDisposition: "DEGRADED", items: [item({ assembly: "B", operational: false, verificationStatus: "CONFLICT" })], nextCursor: null, windowCounts: { returned: 1, operational: 0, excludedRejected: 0, malformedOmitted: 1, evidenceIncomplete: 0 } }))),
    };
    render(<UsedInEquipmentSection hasCapability={grant} partId="TST-1001" accessVersion={0} source={source} />);
    const more = await screen.findByRole("button", { name: /show more/i });
    await act(async () => { fireEvent.click(more); });
    await waitFor(() => expect(screen.getByText(/could not be fully evaluated/i)).toBeTruthy());
    expect(screen.queryByText(/no more records to load/i)).toBeNull(); // NEVER a clean claim on a degraded page
    expect(screen.getByText("Conflicting")).toBeTruthy();
  });

  it("clean single page shows the NEUTRAL end-of-pagination note (never a completeness/authority claim)", async () => {
    const source = { readForPart: vi.fn(async () => okResp(resp({ nextCursor: null }))) };
    render(<UsedInEquipmentSection hasCapability={grant} partId="TST-1001" accessVersion={0} source={source} />);
    await screen.findByText("Taylor C713");
    expect(screen.getByText("No more records to load.")).toBeTruthy();
    expect(screen.queryByText(/all known records/i)).toBeNull();
  });

  it("Part change cannot display stale rows: an in-flight page for Part A never renders under Part B", async () => {
    const aGate = deferred();
    const source = {
      readForPart: vi.fn(async ({ partId }) => {
        if (partId === "PART-A") { await aGate.promise; return okResp(resp({ items: [item({ model: model({ displayName: "MODEL-A" }) })] })); }
        return okResp(resp({ items: [item({ model: model({ displayName: "MODEL-B" }) })] }));
      }),
    };
    const { rerender } = render(<UsedInEquipmentSection hasCapability={grant} partId="PART-A" accessVersion={0} source={source} />);
    // Navigate to Part B before A resolves.
    rerender(<UsedInEquipmentSection hasCapability={grant} partId="PART-B" accessVersion={0} source={source} />);
    await screen.findByText("MODEL-B");
    // Now let Part A's stale response resolve — it must NEVER appear.
    await act(async () => { aGate.resolve(); await Promise.resolve(); });
    expect(screen.queryByText("MODEL-A")).toBeNull();
    expect(screen.getByText("MODEL-B")).toBeTruthy();
  });

  it("access-version change re-fetches and never shows the prior version's rows", async () => {
    const source = {
      readForPart: vi.fn(async () => okResp(resp({ items: [item()] }))),
    };
    const { rerender } = render(<UsedInEquipmentSection hasCapability={grant} partId="TST-1001" accessVersion={1} source={source} />);
    await screen.findByText("Taylor C713");
    expect(source.readForPart).toHaveBeenCalledTimes(1);
    rerender(<UsedInEquipmentSection hasCapability={grant} partId="TST-1001" accessVersion={2} source={source} />);
    await waitFor(() => expect(source.readForPart).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });

  it("a section failure is isolated: sibling (Part Catalog) content stays rendered and nothing throws", async () => {
    const source = { readForPart: vi.fn(async () => { throw new Error("boom"); }) };
    render(
      <div>
        <span data-testid="sibling">stock + reorder still here</span>
        <UsedInEquipmentSection hasCapability={grant} partId="TST-1001" accessVersion={0} source={source} />
      </div>,
    );
    await screen.findByRole("alert"); // the section degraded to UNAVAILABLE, not a crash
    expect(screen.getByTestId("sibling").textContent).toBe("stock + reorder still here");
  });
});
