// NO FIRESTORE ID REACHES A PERSON — the guard, and the proof that it bites.
//
// ============================ WHY NOT A REGEX BAN ============================
//
// The naive version greps the source for id-like strings and fails on every `accountId` in a query.
// That guard gets disabled within a week, because it is wrong far more often than it is right.
//
// So this guards the RENDER PATH instead: it renders the real components with references that do and
// do not resolve, and asserts on what appears on screen. An id used to fetch is correct; an id shown
// to a person is the defect.
//
// ============================ THE MUTATION PROOF ============================
//
// §46 requires that intentionally rendering a raw reference as the normal label makes the guard fail.
// `describe("the guard bites")` does exactly that against the same helper the real screens use — if
// that block ever passes quietly, the guard has stopped working and everything else here is theatre.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import StructuredFields from "../src/shared/ui/StructuredFields.jsx";
import {
  availableUnitFields, serializedUnitFields, partFields, transferFields, field, locationField,
} from "../src/domain/structuredFields.js";
import { ActiveCriteria } from "../src/metadata/MetadataListControls.jsx";
import { workOrderEntity } from "../src/metadata/definitions/workOrder.js";
import { partEntity } from "../src/metadata/definitions/part.js";
import { accountEntity } from "../src/metadata/definitions/account.js";
import { makeCriterion, EMPTY_CRITERIA, addFilter } from "../src/metadata/listUrlState.js";

afterEach(cleanup);

/**
 * What a Firestore id or raw foreign key looks like in this codebase.
 *
 * Deliberately specific to the ID SHAPES this platform actually mints, so the guard catches the real
 * thing without failing on ordinary business text. `WO-2026-0001` and `CW-C161-0001` are BUSINESS
 * identifiers people read aloud — they must pass.
 */
const RAW_ID_PATTERNS = [
  /\bacct-[a-z0-9-]+/i,      // account document ids
  /\bwh-[a-z0-9-]+/i,        // warehouse location ids
  /\bcw-emp-\d+/i,           // employee document ids
  /\bloc-[a-z0-9-]+/i,       // location ids
  /\bsa-[a-z0-9]{6,}/i,      // serialized asset ids
  /\bpart-[a-z0-9]{6,}/i,    // part document ids
  /\bmodel-[a-z0-9-]+/i,     // equipment model document ids (a Part references one)
  /\bmfr-[a-z0-9-]+/i,       // manufacturer document ids
  /\bunresolved id\b/i,      // the parenthetical that admits an id is being shown
  /\(unresolved/i,
];

/**
 * Business identifiers that LOOK id-shaped and MUST pass.
 *
 * The other half of the contract, and the half that decides whether this guard survives: one that
 * rejects `PRT-1001` gets disabled within a week. So the passing cases are asserted against the
 * patterns directly, not just implied by the render tests.
 */
const BUSINESS_IDENTIFIERS = [
  "PRT-1001", "CW-P-0004", "WO-2026-0001", "CW-C161-0001", "ISI-203SN", "IM-0460-AH",
];

/**
 * The rendered VALUES, separated.
 *
 * Not `container.textContent`: concatenating a label and its value produces "Customeracct-harbor",
 * which destroys the word boundary every one of these patterns depends on — the guard would then
 * pass on the exact violation it exists to catch. Values are read individually and joined with a
 * separator, which is also the more precise check: a raw id would appear as a VALUE.
 */
function renderedValues(container) {
  const values = [
    ...container.querySelectorAll(".fo-fields__value"),
    ...container.querySelectorAll(".fo-listctl__chip"),
  ].map((el) => el.textContent);
  // Fall back to the whole node when a surface uses neither structure, so a new surface is still
  // covered rather than silently exempt.
  return (values.length > 0 ? values : [container.textContent]).join(" | ");
}

function assertNoRawIds(container, context) {
  const text = typeof container === "string" ? container : renderedValues(container);
  for (const pattern of RAW_ID_PATTERNS) {
    expect(text, `${context}: rendered a raw id matching ${pattern}`).not.toMatch(pattern);
  }
}

// ═══════════════════════════════════════════ the surfaces

describe("business surfaces show human identities", () => {
  it("an AVAILABLE UNIT with an unresolved location says so, and NEVER shows the key", () => {
    // The exact regression: "Taylor C161 — S/N CW-C161-0001 · AVAILABLE · wh-main (unresolved id)".
    const { container } = render(
      <StructuredFields
        fields={availableUnitFields({
          title: "Taylor C161", serialNo: "CW-C161-0001", lifecycleState: "AVAILABLE",
          location: "wh-main", locationResolved: false, category: "Whole Unit Equipment",
        })}
      />,
    );
    assertNoRawIds(container, "available unit");
    // Label and value are separate elements, which is the point: "Location" + "Unavailable".
    expect(screen.getByText("Location")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    // And the business identity IS shown — a serial is not a document id.
    expect(container.textContent).toContain("CW-C161-0001");
  });

  it("a RESOLVED location shows the place, not the key", () => {
    const { container } = render(
      <StructuredFields
        fields={availableUnitFields({
          title: "Taylor C161", serialNo: "CW-C161-0001", lifecycleState: "AVAILABLE",
          location: "Main Warehouse", locationResolved: true,
        })}
      />,
    );
    expect(container.textContent).toContain("Main Warehouse");
    assertNoRawIds(container, "resolved location");
  });

  it("a serialized unit with no resolvable location renders an absence", () => {
    const { container } = render(
      <StructuredFields fields={serializedUnitFields({ productName: "Taylor C161", serialNo: "S1", inventoryState: "AVAILABLE" }, { locationName: null })} />,
    );
    expect(container.textContent).toContain("Unavailable");
    assertNoRawIds(container, "serialized unit");
  });

  it("a transfer's endpoints are place names or absences, never ids", () => {
    const { container } = render(
      <StructuredFields fields={transferFields({ transferNumber: "TR-1042", status: "IN_TRANSIT" }, { sourceName: null, destinationName: "Truck 12" })} />,
    );
    assertNoRawIds(container, "transfer");
    expect(container.textContent).toContain("TR-1042");
  });

  it("a part shows its SKU, which is a business identifier and not a document id", () => {
    const { container } = render(<StructuredFields fields={partFields({ name: "Seal kit", internalPartNumber: "TS-4410" })} />);
    expect(container.textContent).toContain("TS-4410");
    assertNoRawIds(container, "part");
  });

  it("A FILTER CHIP SHOWS THE CUSTOMER'S NAME, and the id stays in the query", () => {
    const criteria = addFilter(EMPTY_CRITERIA, makeCriterion({
      fieldId: "customerId", operator: "EQUALS",
      value: "acct-harbor", valueLabel: "Harbor Grill Restaurant Group",
    }));
    const { container } = render(
      <ActiveCriteria criteria={criteria} entity={workOrderEntity} onRemove={() => {}} onClear={() => {}} />,
    );
    expect(container.textContent).toContain("Harbor Grill Restaurant Group");
    assertNoRawIds(container, "filter chip");
  });
});

// ═══════════════════════════════════════════ ACCOUNTS

describe("Account identities", () => {
  it("an Account filter chip carries the customer's NAME, never the account id", () => {
    const criteria = addFilter(EMPTY_CRITERIA, makeCriterion({
      fieldId: "status", operator: "EQUALS", value: "PROSPECT", valueLabel: "Prospect",
    }));
    const { container } = render(
      <ActiveCriteria criteria={criteria} entity={accountEntity} onRemove={() => {}} onClear={() => {}} />,
    );
    assertNoRawIds(container, "account status chip");
    expect(container.textContent).toContain("Prospect");
  });

  it("an OWNER that no longer resolves reads as unavailable, not as an employee id", () => {
    // `accountOwner.assignedToEmployeeId` is a routing key. The one moment it is most likely to be
    // rendered is the one where the employee has gone — which is exactly when showing it is worst.
    const { container } = render(
      <StructuredFields
        fields={[
          field({ label: "Customer", value: "Harbor Grill Restaurant Group" }),
          field({ label: "Owner", value: null, absence: "Owner unavailable" }),
        ]}
      />,
    );
    expect(screen.getByText("Owner unavailable")).toBeTruthy();
    assertNoRawIds(container, "unresolved owner");
  });

  it("an Account with no name says so instead of falling back to its document id", () => {
    const { container } = render(
      <StructuredFields
        fields={[field({ label: "Customer", value: null, absence: "Account name unavailable" })]}
      />,
    );
    expect(screen.getByText("Account name unavailable")).toBeTruthy();
    assertNoRawIds(container, "unnamed account");
  });

  it("the Account entity declares NO field whose label promotes a reserved identifier", () => {
    // customerNumber / erpId / accountingId / legacyId are passthrough integration data — not
    // validated, not unique. ACCOUNT NUMBER NOT AUTHORITATIVE: none of them may become a default
    // column, because a column reads as an identity people can rely on.
    for (const id of ["customerNumber", "erpId", "accountingId", "legacyId"]) {
      const f = accountEntity.fields.find((x) => x.id === id);
      expect(f, id).toBeTruthy();
      expect(f.defaultVisible ?? false, `${id} must not be a default column`).toBe(false);
    }
    // And the business identity is the name.
    expect(accountEntity.identity.nameField).toBe("name");
    expect(accountEntity.identity.referenceField).toBeNull();
  });
});

// ═══════════════════════════════════════════ PARTS

describe("Part identities", () => {
  it("business part numbers pass every id pattern untouched", () => {
    for (const id of BUSINESS_IDENTIFIERS) {
      for (const pattern of RAW_ID_PATTERNS) {
        expect(id, `${id} must not look like a document id to ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("a Part row shows its part NUMBER, and the document id appears nowhere", () => {
    const { container } = render(
      <StructuredFields
        fields={partFields({ internalPartNumber: "PRT-1001", name: "Beater assembly", controlType: "STANDARD" })}
      />,
    );
    expect(screen.getByText("PRT-1001")).toBeTruthy();
    assertNoRawIds(container, "part row");
  });

  it("an unresolved equipment model says so instead of falling back to its id", () => {
    // The Part stores `equipmentModelId` and the model's NAME lives on another document — exactly the
    // shape that produces "model-c161 (unresolved id)" on screen when nobody decides what absence
    // should read as.
    const { container } = render(
      <StructuredFields
        fields={[
          field({ label: "Part Number", value: "CW-P-0004" }),
          field({ label: "Equipment Model", value: null, absence: "Equipment model unavailable" }),
        ]}
      />,
    );
    expect(screen.getByText("Equipment model unavailable")).toBeTruthy();
    assertNoRawIds(container, "unresolved equipment model");
  });

  it("a Part filter chip carries the human label, never a document id", () => {
    const criteria = addFilter(EMPTY_CRITERIA, makeCriterion({
      fieldId: "status", operator: "EQUALS", value: "ACTIVE", valueLabel: "Active",
    }));
    const { container } = render(
      <ActiveCriteria criteria={criteria} entity={partEntity} onRemove={() => {}} onClear={() => {}} />,
    );
    assertNoRawIds(container, "part filter chip");
  });
});

// ═══════════════════════════════════════════ THE MUTATION PROOF

describe("the guard bites", () => {
  it("FAILS when a raw PART document id is rendered as the part's label", () => {
    const { container } = render(
      <StructuredFields fields={[field({ label: "Part", value: "part-8f21c4" })]} />,
    );
    expect(() => assertNoRawIds(container, "deliberate violation")).toThrow();
  });

  it("FAILS when an unresolved equipment model falls back to its id", () => {
    const { container } = render(
      <StructuredFields fields={[field({ label: "Equipment Model", value: "model-c161" })]} />,
    );
    expect(() => assertNoRawIds(container, "deliberate violation")).toThrow();
  });

  it("FAILS when a raw account id is rendered as a normal label", () => {
    // Deliberately doing the wrong thing, through the same helper the real screens use.
    const { container } = render(
      <StructuredFields fields={[field({ label: "Customer", value: "acct-harbor" })]} />,
    );
    // The guard must object. If this ever stops throwing, every assertion above is theatre.
    expect(() => assertNoRawIds(container, "deliberate violation")).toThrow();
  });

  it("FAILS when a warehouse key is rendered as a location", () => {
    const { container } = render(
      <StructuredFields fields={[locationField("wh-main")]} />,
    );
    expect(() => assertNoRawIds(container, "deliberate violation")).toThrow();
  });

  it("FAILS on the '(unresolved id)' parenthetical", () => {
    const { container } = render(
      <StructuredFields fields={[field({ label: "Location", value: "wh-main (unresolved id)" })]} />,
    );
    expect(() => assertNoRawIds(container, "deliberate violation")).toThrow();
  });

  it("does NOT fire on legitimate business identifiers", () => {
    // The guard would be disabled within a week if it failed on these.
    const { container } = render(
      <StructuredFields fields={[
        field({ label: "Work Order", value: "WO-2026-000123" }),
        field({ label: "Serial Number", value: "CW-C161-0001" }),
        field({ label: "SKU", value: "TS-4410" }),
        field({ label: "Transfer", value: "TR-1042" }),
      ]} />,
    );
    expect(() => assertNoRawIds(container, "business identifiers")).not.toThrow();
  });
});

// ═══════════════════════════════════════════ the corrected source

describe("the Available Equipment regression is gone from the source", () => {
  it("no longer renders the dot-separated line or the unresolved-id parenthetical", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/modules/equipment/AvailableEquipment.jsx"), "utf8");
    // The exact prose pattern this standard exists to abolish, in the row renderer.
    expect(src).not.toMatch(/\{" — S\/N "\}/);
    // The RENDERED parenthetical is gone. The explanatory comment describing the old bug stays, and
    // should — a reader needs to know what this replaced and why.
    expect(src).not.toMatch(/locationResolved \? " \(unresolved/);
    expect(src).toMatch(/StructuredFields/);
  });
});
