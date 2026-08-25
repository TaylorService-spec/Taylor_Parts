// THE RENDERED NORTH STAR CONTRACT.
//
// workOrderNorthStar.test.mjs proves the derivations. These prove the SURFACE: that the grammar's
// ordering law holds in the DOM, that honest states stay distinct when rendered, and that no
// document id reaches the screen. A page can pass every domain test and still render an apology —
// that happened on the Sales Agreement record page this week, when its metadata was correct and
// unreachable.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RecordIdentity from "../src/shared/ui/RecordIdentity.jsx";
import AttentionBand from "../src/shared/ui/AttentionBand.jsx";
import RuledSection from "../src/shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../src/shared/ui/HonestState.jsx";

const RAW_ID = /\b[A-Za-z0-9]{20}\b/;

describe("RecordIdentity — the enterprise record header", () => {
  it("THE GOVERNED REFERENCE IS THE PAGE'S SINGLE h1 (R02)", () => {
    render(
      <RecordIdentity kicker="Work Order · Repair · P2 High" reference="WO-2026-000873"
        fallbackName="Work Order" statusWords="Dispatched" statusTone="neutral" />,
    );
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("WO-2026-000873");
  });

  it("A RECORD WITH NO REFERENCE NEVER BORROWS THE DOCUMENT ID (R03)", () => {
    // DECISIONS #106 has no escape clause. The id is not even accepted as a prop, so this asserts
    // the contract that makes the mistake unavailable.
    const { container } = render(
      <RecordIdentity kicker="Work Order" reference={null} fallbackName="Work Order" statusWords="Created" />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Work Order");
    expect(container.textContent).not.toMatch(RAW_ID);
  });

  it("an unrecognised state is STATED, not rendered blank", () => {
    render(<RecordIdentity kicker="Work Order" reference="WO-2026-000873" statusWords={null} />);
    expect(screen.getByText(/state not recognised/i)).toBeTruthy();
  });

  it("empty facts are dropped rather than rendered as stray separators", () => {
    render(
      <RecordIdentity reference="WO-1" statusWords="Created"
        facts={[{ key: "a", label: "Tech", value: "J. Barela" }, { key: "b", label: "Window", value: null }, { key: "c", value: "" }]} />,
    );
    expect(screen.getByText("J. Barela")).toBeTruthy();
    expect(screen.queryByText("Window")).toBeNull();
  });
});

describe("AttentionBand — pattern 3", () => {
  it("RENDERS NOTHING WHEN CLEAN", () => {
    // The absence of the band IS the clean signal. A band that says "no issues" every time trains
    // people not to look at it.
    const { container } = render(<AttentionBand items={[]} />);
    expect(container.innerHTML).toBe("");
    const empty = render(<AttentionBand items={undefined} />);
    expect(empty.container.innerHTML).toBe("");
  });

  it("renders EVERY blocker at once, each with a severity WORD (R04, R08)", () => {
    render(<AttentionBand items={[
      { key: "a", severity: "BLOCKING", fact: "No technician assigned." },
      { key: "b", severity: "BLOCKING", fact: "Not scheduled — no visit window has been set." },
      { key: "c", severity: "ATTENTION", fact: "No parts planned." },
    ]} />);
    expect(screen.getAllByText("Blocking")).toHaveLength(2);
    expect(screen.getAllByText("Needs attention")).toHaveLength(1);
    expect(screen.getByText(/no technician assigned/i)).toBeTruthy();
    expect(screen.getByText(/no parts planned/i)).toBeTruthy();
  });

  it("is a labelled region, so it is reachable rather than decorative", () => {
    render(<AttentionBand items={[{ key: "a", severity: "BLOCKING", fact: "x" }]} />);
    expect(screen.getByRole("region", { name: /needs attention/i })).toBeTruthy();
  });
});

describe("HonestState — the six situations stay apart (NS-P3)", () => {
  it("DENIED IS NOT EMPTY", () => {
    // The specific defect: a denial rendered as an empty region tells an operator their data is
    // missing when their permission is.
    render(<HonestState state={HONEST_STATE.DENIED} subject="Accounts Receivable" />);
    expect(screen.getByText(/isn't part of your role/i)).toBeTruthy();
    expect(screen.queryByText(/no records/i)).toBeNull();
  });

  it("NOT ENABLED is one sentence — never a page of padlocks", () => {
    const { container } = render(<HonestState state={HONEST_STATE.NOT_ENABLED} subject="Activity Notes" />);
    expect(screen.getByText(/isn't switched on for this workspace yet/i)).toBeTruthy();
    expect(container.querySelectorAll("button, [aria-disabled='true']")).toHaveLength(0);
  });

  it("UNAVAILABLE says your other work is unaffected", () => {
    // The difference between a failed panel and a frightening application.
    render(<HonestState state={HONEST_STATE.UNAVAILABLE} subject="Sales Orders" />);
    expect(screen.getByText(/your work elsewhere is unaffected/i)).toBeTruthy();
  });

  it("every state renders DIFFERENT copy — none collapses into another", () => {
    const seen = new Map();
    for (const state of Object.values(HONEST_STATE)) {
      const { container, unmount } = render(<HonestState state={state} subject="Work orders" />);
      const text = container.textContent.trim();
      expect(text.length).toBeGreaterThan(0);
      for (const [other, otherText] of seen) {
        expect(text).not.toBe(otherText, `${state} renders identically to ${other}`);
      }
      seen.set(state, text);
      unmount();
    }
  });

  it("AN UNMAPPED STATE IS REPORTED, not rendered as nothing", () => {
    // A blank here would be the exact fail-blank defect this component exists to remove.
    const { container } = render(<HonestState state="SOMETHING_NEW" subject="x" />);
    expect(container.textContent.trim().length).toBeGreaterThan(0);
  });
});

describe("RuledSection — structure without boxes", () => {
  it("is a section with a heading, and carries no card class", () => {
    const { container } = render(<RuledSection title="Parts plan"><p>body</p></RuledSection>);
    expect(screen.getByRole("heading", { name: "Parts plan" })).toBeTruthy();
    expect(container.querySelector(".fo-panel")).toBeNull();
    expect(container.querySelector(".ns-section--panel")).toBeNull();
  });

  it("THE PANEL VARIANT IS OPT-IN, for editors only (R13)", () => {
    const { container } = render(<RuledSection title="Edit parts plan" panel><p>form</p></RuledSection>);
    expect(container.querySelector(".ns-section--panel")).toBeTruthy();
  });

  it("a section title is h2, so the record's h1 stays unique", () => {
    render(<RuledSection title="Timeline"><p>x</p></RuledSection>);
    expect(screen.getByRole("heading", { level: 2, name: "Timeline" })).toBeTruthy();
  });
});
