// accountPageComponents.js -- registration + capability-gated rendering tests.
//
// Two concerns, kept deliberately separate:
//   1. REGISTRATION -- registerAccountPageComponents() (the REAL adapters, wrapping the REAL
//      src/modules/accounts/ components) actually resolves every componentId accountRecordPage
//      names, and the registry's own duplicate-registration contract still holds through this
//      module. Iterates accountRecordPage's own sections rather than a hand-typed id list, so
//      this test cannot silently go stale if accountPage.js's componentId set ever changes.
//   2. VISIBILITY -- the exact subset definitions AccountDetail.jsx renders through the metadata
//      path (accountRecordPageMainSubset / accountRecordPageSideSubset) compose correctly with
//      MetadataRecordPage + a caller-supplied capabilityDecisions map: a gated section absent
//      from the DOM when denied, present when explicitly granted, and an EMPTY decisions map
//      hiding every gated section (fail-closed) rather than revealing it. These render through
//      TEST-DOUBLE components registered under the same ids the real ones use -- the real
//      src/modules/accounts/ components are exercised by registration (#1) and by their own
//      component-specific tests; what belongs HERE is proving the wiring (registry -> plan ->
//      visibility -> DOM) never quietly reveals or hides the wrong thing, independent of what a
//      section happens to render.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MetadataRecordPage from "../src/metadata/MetadataRecordPage.jsx";
import { componentRegistry } from "../src/metadata/registry.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import {
  registerAccountPageComponents,
  accountPageComponentIds,
  accountRecordPageMainSubset,
  accountRecordPageSideSubset,
} from "../src/metadata/definitions/accountPageComponents.js";

describe("registerAccountPageComponents", () => {
  beforeEach(() => {
    componentRegistry.__resetForTest();
  });

  it("resolves every componentId accountRecordPage's sections name -- discovered, not hardcoded", () => {
    // The set under test is read off the real definition, exactly as CI/pageRuntime would --
    // if accountPage.js ever names a sixth section, this test still covers it with no edit.
    const declaredIds = [...new Set(accountRecordPage.sections.map((s) => s.componentId).filter(Boolean))];
    expect(declaredIds.length).toBeGreaterThan(0);
    expect(declaredIds).toEqual(accountPageComponentIds());

    registerAccountPageComponents();

    for (const id of declaredIds) {
      expect(componentRegistry.has(id)).toBe(true);
    }
  });

  it("registering twice throws -- the registry's own contract (re-registering an id is refused, never shadowed)", () => {
    registerAccountPageComponents();
    expect(() => registerAccountPageComponents()).toThrow();
  });
});

describe("accountRecordPageMainSubset / accountRecordPageSideSubset -- capability-gated visibility", () => {
  const FIN_MARK = "financials section rendered";
  const NOTES_MARK = "activity and notes section rendered";
  const SERVICE_MARK = "service activity section rendered";
  const ATTENTION_MARK = "account attention section rendered";

  beforeEach(() => {
    componentRegistry.__resetForTest();
    // Test doubles under the SAME ids accountPage.js names -- proves the wiring (plan ->
    // visibility -> DOM), independent of what the real src/modules/accounts/ components
    // actually render (that is registerAccountPageComponents' + those components' own concern).
    componentRegistry.register({
      id: "accountFinancialsSection",
      kind: "RECORD_SECTION",
      component: () => <p>{FIN_MARK}</p>,
    });
    componentRegistry.register({
      id: "accountActivityAndNotesSection",
      kind: "RECORD_SECTION",
      component: () => <p>{NOTES_MARK}</p>,
    });
    componentRegistry.register({
      id: "accountServiceActivity",
      kind: "RECORD_SECTION",
      component: () => <p>{SERVICE_MARK}</p>,
    });
    componentRegistry.register({
      id: "accountAttentionSection",
      kind: "RECORD_SECTION",
      component: () => <p>{ATTENTION_MARK}</p>,
    });
  });

  it("financials and activityAndNotes carry the real declared capability requirements", () => {
    const byId = Object.fromEntries(accountRecordPageMainSubset.sections.map((s) => [s.id, s]));
    expect(byId.financials.capabilityRequirement).toBe("finance.read");
    expect(byId.activityAndNotes.capabilityRequirement).toBe("crm.activity.read");
    expect(byId.serviceActivity.capabilityRequirement).toBeNull();
    const side = Object.fromEntries(accountRecordPageSideSubset.sections.map((s) => [s.id, s]));
    expect(side.accountAttention.capabilityRequirement).toBe("finance.read");
  });

  it("a section whose capability is not granted does not render -- absent from the DOM, not merely invisible", () => {
    render(
      <MetadataRecordPage
        definition={accountRecordPageMainSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": false, "crm.activity.read": false }}
      />
    );
    expect(screen.queryByText(FIN_MARK)).toBeNull();
    expect(screen.queryByText(NOTES_MARK)).toBeNull();
    // The ungated section is unaffected by either denial.
    expect(screen.getByText(SERVICE_MARK)).toBeTruthy();
  });

  it("an explicit grant reveals the section, and only the section that capability covers", () => {
    render(
      <MetadataRecordPage
        definition={accountRecordPageMainSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
      />
    );
    expect(screen.getByText(FIN_MARK)).toBeTruthy();
    // finance.read grants financials, not activityAndNotes -- that needs crm.activity.read,
    // which this decisions map never answers.
    expect(screen.queryByText(NOTES_MARK)).toBeNull();
    expect(screen.getByText(SERVICE_MARK)).toBeTruthy();
  });

  it("the fail-closed default: an empty decisions map hides every gated section across both subsets", () => {
    const { container } = render(
      <>
        <MetadataRecordPage definition={accountRecordPageMainSubset} record={{ id: "acct-1" }} capabilityDecisions={{}} />
        <MetadataRecordPage definition={accountRecordPageSideSubset} record={{ id: "acct-1" }} capabilityDecisions={{}} />
      </>
    );
    expect(screen.queryByText(FIN_MARK)).toBeNull();
    expect(screen.queryByText(NOTES_MARK)).toBeNull();
    expect(screen.queryByText(ATTENTION_MARK)).toBeNull();
    // serviceActivity has no capabilityRequirement -- an empty map cannot hide what was never gated.
    expect(screen.getByText(SERVICE_MARK)).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("the SIDE subset's accountAttention is granted by the same finance.read decision as financials", () => {
    render(
      <MetadataRecordPage
        definition={accountRecordPageSideSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
      />
    );
    expect(screen.getByText(ATTENTION_MARK)).toBeTruthy();
  });
});
