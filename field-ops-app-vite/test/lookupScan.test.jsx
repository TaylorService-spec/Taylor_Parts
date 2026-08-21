// LOOKUP-ONLY SCANNING — the assembled surface (vitest + jsdom).
//
// The decision logic is proved pure in test/partLookup.test.mjs. These cover what only the mounted
// screen can show: that every outcome reaches the user in its own words, that an absent value is
// visibly a statement rather than a blank, and that the screen has no way to move anything.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import LookupScan from "../src/modules/scan/LookupScan.jsx";

afterEach(cleanup);

const PART = {
  invalid: false, partId: "PRT-1001", internalPartNumber: "TS-1001", name: "Compressor relay",
  description: "Start relay, 240V", category: "Electrical", status: "ACTIVE",
  stockingUnit: "EACH", controlType: "SERIALIZED", stockingClass: "STOCKED", version: 3,
};

const catalog = (result) => vi.fn().mockResolvedValue(result);
const readable = (...parts) => catalog({ ok: true, parts, invalid: [] });

// The identifier half. Phase G made every lookup ask TWO questions, so every test has to answer
// both — the default is "not a registered identifier either", which is what makes a bare NOT_FOUND
// an honest answer rather than half a search reported as a whole one.
const identifier = (outcome) => vi.fn().mockResolvedValue(outcome);
const noIdentifierMatch = () => identifier({ result: { result: "NOT_FOUND" } });

const lookUp = (fetchParts, token = "PRT-1001", resolveIdentifier = noIdentifierMatch()) => {
  render(<LookupScan deps={{ fetchParts, resolveIdentifier }} />);
  fireEvent.change(screen.getByLabelText(/part code or barcode/i), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: /look up/i }));
};

// ────────────────────────────────────────────── outcomes reach the user

describe("Lookup (every outcome has its own words)", () => {
  it("resolves a known part and shows its authoritative fields", async () => {
    lookUp(readable(PART));
    expect(await screen.findByRole("heading", { name: /compressor relay/i })).toBeTruthy();
    const card = screen.getByRole("region", { name: /part TS-1001/i });
    expect(within(card).getByText("TS-1001")).toBeTruthy();
    expect(within(card).getByText("ACTIVE")).toBeTruthy();
    expect(within(card).getByText("SERIAL")).toBeTruthy();   // derived from SERIALIZED
  });

  it("says NOT FOUND without claiming the part does not exist", async () => {
    lookUp(readable(PART), "PRT-9999");
    const msg = await screen.findByText(/no governed record matches/i);
    expect(msg.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("heading", { name: /compressor relay/i })).toBeNull();
  });

  it("says AMBIGUOUS and refuses to pick one", async () => {
    const other = { ...PART, partId: "TS-1001", internalPartNumber: "TS-2002", name: "Other part" };
    lookUp(readable(PART, other), "TS-1001");
    expect(await screen.findByText(/matches more than one governed record/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /compressor relay/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /other part/i })).toBeNull();
  });

  it("says INVALID for a token it cannot read", async () => {
    lookUp(readable(PART), "{}");
    expect(await screen.findByText(/couldn.t be read/i)).toBeTruthy();
  });

  it("a DENIED read is an alert worded as a refusal, never as an absence", async () => {
    lookUp(catalog({ ok: false, code: "permission-denied" }));
    const msg = await screen.findByRole("alert");
    expect(msg.textContent).toMatch(/not authorized/i);
    expect(msg.textContent).not.toMatch(/no governed record|not found/i);
  });

  it("a FAILED read is an alert, and is NOT reported as no match", async () => {
    lookUp(catalog({ ok: false, code: "unavailable" }));
    const msg = await screen.findByRole("alert");
    expect(msg.textContent).toMatch(/could not be read/i);
    expect(msg.textContent).not.toMatch(/no governed record/i);
  });

  it("a THROWN read is a failed read, not an empty catalog", async () => {
    lookUp(vi.fn().mockRejectedValue(new Error("offline")));
    const msg = await screen.findByRole("alert");
    expect(msg.textContent).toMatch(/could not be read/i);
  });

  it("shows a LOADING state while the governed read is in flight", async () => {
    let release;
    lookUp(vi.fn(() => new Promise((r) => { release = () => r({ ok: true, parts: [PART], invalid: [] }); })));
    expect(await screen.findByText(/looking that up/i)).toBeTruthy();
    release();
    expect(await screen.findByRole("heading", { name: /compressor relay/i })).toBeTruthy();
  });

  it("starts IDLE, having read nothing", () => {
    const fetchParts = readable(PART);
    render(<LookupScan deps={{ fetchParts }} />);
    expect(screen.getByText(/scan a part label or barcode/i)).toBeTruthy();
    expect(fetchParts).not.toHaveBeenCalled();
  });

  it("an empty submission asks NEITHER question and stays IDLE", () => {
    const fetchParts = readable(PART);
    const resolveIdentifier = noIdentifierMatch();
    render(<LookupScan deps={{ fetchParts, resolveIdentifier }} />);
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(fetchParts).not.toHaveBeenCalled();
    expect(resolveIdentifier).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────── UNKNOWN is visible

describe("Lookup (a missing value is a statement, not a blank)", () => {
  // Phase H made these three rows real governed reads. Their capabilities are inert, so the
  // production answer is a refusal — injected here so the assertion is deterministic rather than
  // whatever the ambient transports happen to do under jsdom.
  const deniedReads = {
    fetchBalance: vi.fn().mockResolvedValue({ errorStatus: "transport-not-ready" }),
    fetchSerialized: vi.fn().mockResolvedValue({ errorStatus: "permission-denied" }),
    fetchLocations: vi.fn().mockResolvedValue({ errorStatus: "permission-denied" }),
  };

  it("renders a refused inventory row with its reason instead of omitting it", async () => {
    render(<LookupScan deps={{ fetchParts: readable(PART), resolveIdentifier: noIdentifierMatch(), ...deniedReads }} />);
    fireEvent.change(screen.getByLabelText(/part code or barcode/i), { target: { value: "PRT-1001" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));

    const card = await screen.findByRole("region", { name: /part TS-1001/i });
    for (const label of ["Serialized units", "Location", "On hand"]) {
      expect(within(card).getByText(label)).toBeTruthy();
    }
    await waitFor(() => expect(within(card).getAllByText(/not switched on/i).length).toBeGreaterThan(0));
  });

  it("a refused balance is NEVER rendered as zero or blank", async () => {
    render(<LookupScan deps={{ fetchParts: readable(PART), resolveIdentifier: noIdentifierMatch(), ...deniedReads }} />);
    fireEvent.change(screen.getByLabelText(/part code or barcode/i), { target: { value: "PRT-1001" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));

    const card = await screen.findByRole("region", { name: /part TS-1001/i });
    await waitFor(() => {
      const value = within(card).getByText("On hand").closest(".fo-lookup__row").querySelector("dd").textContent;
      expect(value).toMatch(/not switched on/i);
      expect(value).not.toMatch(/^0$|^-$|^—$/);
    });
  });

  it("inventory rows say they are READING before the answers arrive — never that they failed", async () => {
    // The part card renders as soon as identity resolves. Saying "could not be read" at that moment
    // would be false and alarming: nothing had been attempted yet.
    let releaseBalance;
    render(<LookupScan deps={{
      fetchParts: readable(PART),
      resolveIdentifier: noIdentifierMatch(),
      fetchBalance: vi.fn(() => new Promise((r) => { releaseBalance = () => r({ errorStatus: "transport-not-ready" }); })),
      fetchSerialized: vi.fn().mockResolvedValue({ errorStatus: "permission-denied" }),
      fetchLocations: vi.fn().mockResolvedValue({ errorStatus: "permission-denied" }),
    }} />);
    fireEvent.change(screen.getByLabelText(/part code or barcode/i), { target: { value: "PRT-1001" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));

    const card = await screen.findByRole("region", { name: /part TS-1001/i });
    const onHand = () => within(card).getByText("On hand").closest(".fo-lookup__row").querySelector("dd").textContent;
    expect(onHand()).toMatch(/reading/i);
    expect(onHand()).not.toMatch(/could not be read/i);

    releaseBalance();
    await waitFor(() => expect(onHand()).toMatch(/not switched on/i));
  });

  it("an empty description says UNKNOWN with a reason rather than showing nothing", async () => {
    lookUp(readable({ ...PART, description: "" }));
    const card = await screen.findByRole("region", { name: /part TS-1001/i });
    const dd = within(card).getByText("Description").closest(".fo-lookup__row").querySelector("dd");
    expect(dd.textContent).toMatch(/unknown/i);
    expect(dd.textContent).toMatch(/no description on the part record/i);
  });

  it("an unmappable control type shows UNKNOWN tracking, not a guessed mode", async () => {
    lookUp(readable({ ...PART, controlType: "SERIALIZED_LOT" }));
    const card = await screen.findByRole("region", { name: /part TS-1001/i });
    const dd = within(card).getByText("Tracking").closest(".fo-lookup__row").querySelector("dd");
    expect(dd.textContent).toMatch(/unknown/i);
    expect(dd.textContent).not.toMatch(/\bLOT\b|\bNONE\b|\bSERIAL\b/);
  });

  it("absent values are marked so they are visibly not data", async () => {
    lookUp(readable(PART));
    const card = await screen.findByRole("region", { name: /part TS-1001/i });
    expect(card.querySelectorAll(".fo-lookup__absent").length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────── it moves nothing

describe("Lookup (reads only)", () => {
  it("offers no control that could move, count or change stock", async () => {
    lookUp(readable(PART));
    await screen.findByRole("heading", { name: /compressor relay/i });
    for (const forbidden of [/receive/i, /adjust/i, /transfer/i, /count/i, /use/i, /consume/i, /submit/i, /save/i, /confirm/i, /\+/, /-/]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
    // exactly one control: the lookup itself
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("has no quantity input", async () => {
    lookUp(readable(PART));
    await screen.findByRole("heading", { name: /compressor relay/i });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("says so on the screen, standing, not only in a tooltip", () => {
    render(<LookupScan deps={{ fetchParts: readable(PART) }} />);
    expect(screen.getByText(/reads only.*nothing here moves/i)).toBeTruthy();
  });

  it("imports no writer — checked on the BINDINGS, not the module path", () => {
    // Phase G made this precise. LookupScan now imports from partAliasCallableClient, which also
    // exports create/deactivate/reactivate — so a path-level ban would either fail wrongly or have
    // to be loosened into meaninglessness. What actually matters is WHICH bindings come across.
    // import.meta.url is an http URL under vitest, so resolve from the project root instead.
    const src = readFileSync(resolve(process.cwd(), "src/modules/scan/LookupScan.jsx"), "utf8");
    const bindings = [...src.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))[^;]*from/g)]
      .flatMap((m) => (m[1] ? m[1].split(",") : [m[2]]))
      .map((b) => b.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);

    expect(bindings.length).toBeGreaterThan(0);
    for (const b of bindings) {
      expect(b).not.toMatch(/^(create|update|delete|submit|receive|adjust|transfer|deactivate|reactivate|post|save)/i);
    }
    // and specifically: exactly ONE thing from the alias transport, the resolve-only read
    const aliasImport = src.match(/import\s*\{([^}]*)\}\s*from\s*"[^"]*partAliasCallableClient[^"]*"/);
    expect(aliasImport?.[1].trim()).toBe("resolveScannedIdentifier");
  });
});
