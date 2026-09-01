// PART MASTER > BARCODE & IDENTIFIERS — the administration surface (vitest + jsdom).
//
// This section spent its whole life rendering UNAVAILABLE and naming three missing pieces. Two are
// now closed. The thing that must NOT be lost in making it live is the honesty it had: there are
// four distinct reasons this list can be empty of content, and only ONE of them is "this part has
// no identifiers". These tests exist to keep the other three from collapsing into that claim.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import PartIdentifiersSection from "../src/shared/partMaster/PartIdentifiersSection.jsx";
import { NOT_READY_STATUS } from "../src/services/partAliasCallableClient.js";

afterEach(cleanup);

const alias = (over = {}) => ({
  aliasId: "UPC%2F012345678905",
  aliasType: "UPC",
  value: "012345678905",
  status: "ACTIVE",
  source: "manual",
  manufacturerId: null,
  effectiveFrom: null,
  effectiveTo: null,
  version: 1,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  ...over,
});

function mockClient(over = {}) {
  return {
    listPartAliases: vi.fn().mockResolvedValue({ result: { partId: "P1", aliases: [], truncated: false, limit: 200 } }),
    createPartAlias: vi.fn().mockResolvedValue({ result: { outcome: "applied", version: 1, aliasId: "a1" } }),
    deactivatePartAlias: vi.fn().mockResolvedValue({ result: { outcome: "applied", version: 2 } }),
    reactivatePartAlias: vi.fn().mockResolvedValue({ result: { outcome: "applied", version: 3 } }),
    probePartAlias: vi.fn().mockResolvedValue({ result: { result: "NOT_FOUND" } }),
    ...over,
  };
}

const renderSection = (client) =>
  render(<PartIdentifiersSection partId="P1" partNumber="PRT-1001" deps={{ client }} />);

// ─────────────────────────────────────────────────── four states, never collapsed

describe("Barcodes & Identifiers (an unread list is never reported as an empty one)", () => {
  it("transport switched off reads as UNAVAILABLE, not as 'no identifiers'", async () => {
    const client = mockClient({
      listPartAliases: vi.fn().mockResolvedValue({ errorStatus: NOT_READY_STATUS }),
    });
    renderSection(client);
    // THE SEMANTIC, NOT THE OLD SENTENCE. P1v2 (Owner ruling A3, 2026-08-31) restructured this to
    // Design's two-line grammar: "Alternate identifiers are unread, not empty — <reason>", where
    // the previous form was "Identifiers cannot be shown for X. <reason> This is not an empty list
    // — it is an unread one." The DISTINCTION this test exists to protect is unchanged and is
    // asserted more directly than before -- the message must say UNREAD, must deny EMPTY, and must
    // still not be confusable with the genuinely-empty case below it.
    const msg = await screen.findByText(/unread/i);
    expect(msg.textContent).toMatch(/not empty|not an empty list/i);
    expect(msg.textContent).toMatch(/unread/i);
    expect(screen.queryByText(/No identifiers are recorded/i)).toBeNull();
  });

  it("a DENIAL reads as a denial, not as 'no identifiers'", async () => {
    const client = mockClient({
      listPartAliases: vi.fn().mockResolvedValue({ errorStatus: "permission-denied", errorDetail: "DENIED" }),
    });
    renderSection(client);
    expect(await screen.findByText(/not authorized to manage part identifiers/i)).toBeTruthy();
    expect(screen.queryByText(/No identifiers are recorded/i)).toBeNull();
  });

  it("a FAILED read offers a retry rather than asserting anything about the data", async () => {
    const list = vi.fn().mockResolvedValue({ errorStatus: "internal", errorDetail: "INTERNAL" });
    renderSection(mockClient({ listPartAliases: list }));
    const retry = await screen.findByRole("button", { name: /retry/i });
    expect(screen.queryByText(/No identifiers are recorded/i)).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("a genuinely empty list is the ONE case that says so, as a fact about the part", async () => {
    renderSection(mockClient());
    const empty = await screen.findByText(/No identifiers are recorded for PRT-1001/i);
    expect(empty.textContent).toMatch(/will not resolve/i);
  });
});

// ─────────────────────────────────────────────────── the list

describe("Barcodes & Identifiers (the list)", () => {
  const withRows = () =>
    mockClient({
      listPartAliases: vi.fn().mockResolvedValue({
        result: {
          partId: "P1",
          aliases: [alias(), alias({ aliasId: "L%2FOLD1", aliasType: "LEGACY", value: "OLD-1", status: "INACTIVE", version: 4 })],
          truncated: false,
          limit: 200,
        },
      }),
    });

  it("shows plain-language type labels, not the raw enum", async () => {
    renderSection(withRows());
    // Scoped to the table: the same label legitimately appears again as an option in the add
    // form's type dropdown, which is the point — one vocabulary in both places.
    const table = await screen.findByRole("table", { name: /identifiers for PRT-1001/i });
    expect(within(table).getByText("UPC barcode")).toBeTruthy();
    expect(within(table).getByText("Legacy identifier")).toBeTruthy();
    expect(screen.queryByText("BARCODE_OTHER")).toBeNull();
    expect(within(table).queryByText("UPC")).toBeNull();
  });

  it("shows INACTIVE identifiers rather than hiding them", async () => {
    // Load-bearing: re-adding a deactivated identifier is refused as a conflict, and an
    // administrator who cannot see this row cannot understand the refusal.
    renderSection(withRows());
    expect(await screen.findByText(/identifier inactive/i)).toBeTruthy();
    expect(screen.getByText("OLD-1")).toBeTruthy();
  });

  it("offers Deactivate for an active identifier and Reactivate for an inactive one", async () => {
    renderSection(withRows());
    expect(await screen.findByRole("button", { name: /^deactivate$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^reactivate$/i })).toBeTruthy();
  });

  it("deactivate sends the alias id AND its version — the concurrency token the command requires", async () => {
    const client = withRows();
    renderSection(client);
    fireEvent.click(await screen.findByRole("button", { name: /^deactivate$/i }));
    await waitFor(() => expect(client.deactivatePartAlias).toHaveBeenCalled());
    const payload = client.deactivatePartAlias.mock.calls[0][0];
    expect(payload.aliasId).toBe("UPC%2F012345678905");
    expect(payload.expectedVersion).toBe(1);
    expect(payload.idempotencyKey).toBeTruthy();
  });

  it("a successful change re-reads authoritatively instead of patching locally", async () => {
    // The server owns the new version token; a locally-invented one would fail the NEXT change
    // with a conflict nobody could explain.
    const client = withRows();
    renderSection(client);
    await screen.findByRole("button", { name: /^deactivate$/i });
    expect(client.listPartAliases).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));
    await waitFor(() => expect(client.listPartAliases).toHaveBeenCalledTimes(2));
  });

  it("a truncated list says it is incomplete", async () => {
    const client = mockClient({
      listPartAliases: vi.fn().mockResolvedValue({
        result: { partId: "P1", aliases: [alias()], truncated: true, limit: 200 },
      }),
    });
    renderSection(client);
    expect(await screen.findByText(/not complete/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────── adding

describe("Barcodes & Identifiers (adding)", () => {
  const fillAndSubmit = async (client, { type = "UPC", value = "012345678905" } = {}) => {
    renderSection(client);
    await screen.findByLabelText(/^type$/i);
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: type } });
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /add identifier/i }));
  };

  it("sends the typed value and an idempotency key", async () => {
    const client = mockClient();
    await fillAndSubmit(client);
    await waitFor(() => expect(client.createPartAlias).toHaveBeenCalled());
    const payload = client.createPartAlias.mock.calls[0][0];
    expect(payload).toMatchObject({ partId: "P1", aliasType: "UPC", rawValue: "012345678905" });
    expect(payload.idempotencyKey).toBeTruthy();
  });

  it("refuses an obviously-invalid GS1 value WITHOUT spending a round trip, and says why", async () => {
    const client = mockClient();
    await fillAndSubmit(client, { type: "EAN", value: "123" });
    expect(await screen.findByText(/13 digits/i)).toBeTruthy();
    expect(client.createPartAlias).not.toHaveBeenCalled();
  });

  it("asks for a manufacturer only for a manufacturer part number", async () => {
    renderSection(mockClient());
    await screen.findByLabelText(/^type$/i);
    expect(screen.queryByLabelText(/manufacturer/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "MANUFACTURER_PN" } });
    expect(screen.getByLabelText(/manufacturer/i)).toBeTruthy();
  });

  it("a CONFLICT keeps the typed value on screen and points at the list", async () => {
    // The recovery is "look at the list and decide" — throwing away what they typed would make
    // them retype it in order to do that.
    const client = mockClient({
      createPartAlias: vi.fn().mockResolvedValue({ errorStatus: "already-exists", errorDetail: "ALIAS_CONFLICT" }),
    });
    await fillAndSubmit(client);
    expect(await screen.findByText(/already recorded/i)).toBeTruthy();
    expect(screen.getByLabelText(/^value$/i).value).toBe("012345678905");
  });

  it("a successful add clears the value so the next one can be scanned straight in", async () => {
    const client = mockClient();
    await fillAndSubmit(client);
    await waitFor(() => expect(screen.getByLabelText(/^value$/i).value).toBe(""));
  });
});

// ─────────────────────────────────────────────────── scan-to-test

describe("Barcodes & Identifiers (scan-to-test)", () => {
  const probeWith = async (result) => {
    const client = mockClient({ probePartAlias: vi.fn().mockResolvedValue({ result }) });
    renderSection(client);
    await screen.findByLabelText(/^value$/i);
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: "ABC-1" } });
    fireEvent.click(screen.getByRole("button", { name: /test this scan/i }));
    return client;
  };

  it("confirms when a scan resolves to THIS part", async () => {
    await probeWith({ result: "FOUND", partId: "P1" });
    expect(await screen.findByText(/resolves to THIS part/i)).toBeTruthy();
  });

  it("warns, and names the other part, when a scan resolves elsewhere", async () => {
    await probeWith({ result: "FOUND", partId: "P9" });
    expect(await screen.findByText(/DIFFERENT part \(P9\)/i)).toBeTruthy();
  });

  it("tells an INACTIVE identifier apart from an unregistered one", async () => {
    await probeWith({ result: "INACTIVE", partId: "P1" });
    expect(await screen.findByText(/INACTIVE/i)).toBeTruthy();
    expect(screen.getByText(/reactivate it below/i)).toBeTruthy();
  });

  it("testing a scan changes nothing", async () => {
    const client = await probeWith({ result: "NOT_FOUND" });
    await screen.findByText(/would not find it/i);
    expect(client.createPartAlias).not.toHaveBeenCalled();
    expect(client.deactivatePartAlias).not.toHaveBeenCalled();
    // and it does not disturb the list
    expect(client.listPartAliases).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────── the standing statement

describe("Barcodes & Identifiers (there is no edit, and it says so)", () => {
  it("explains deactivate-then-add rather than offering an Edit that would delete and recreate", async () => {
    renderSection(mockClient());
    const note = await screen.findByText(/There is no edit/i);
    expect(note.textContent).toMatch(/deactivate the old one/i);
    expect(note.textContent).toMatch(/Nothing is deleted/i);
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });
});
