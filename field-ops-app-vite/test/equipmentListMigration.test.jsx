// TWO EQUIPMENT LISTS, ONE DOMAIN — and the boundary between them.
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md, "UX core object migrations".
//
// The register at modules/equipment/EquipmentRegister.jsx answers "what equipment belongs to THIS
// account". The Customer Equipment tab answers "what installed equipment exists across the
// business". They are different questions, and the tempting move — widening the register until it
// answers both — would undo a deliberate §7 scoping decision AND break the create flow, which needs
// one fixed Account because the Location options and the write itself are scoped to it.
//
// So these tests hold that boundary, and hold the global list to the query honesty the register
// never had to meet.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { equipmentEntity, equipmentIndexList } from "../src/metadata/definitions/equipment.js";
import { buildQueryDescriptor } from "../src/metadata/listRuntime.js";
import { pickLocationName } from "../src/hooks/useLocationReferenceResolver.js";
import declaredIndexes from "../../firestore.indexes.json" with { type: "json" };

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const GLOBAL = read("src/modules/equipment/CustomerEquipment.jsx");
const REGISTER = read("src/modules/equipment/EquipmentRegister.jsx");

// ═════════════════════════════════════════ the account register keeps its scope

describe("the Account register is NOT widened", () => {
  it("still reads equipment for ONE account", () => {
    expect(REGISTER).toMatch(/useEquipmentForAccount/);
  });

  it("does not mount the global list runtime", () => {
    // Not "does not contain the word": asserted on imports, because the register's header
    // discusses the bounded read at length.
    expect(REGISTER).not.toMatch(/^import .*useMetadataList/m);
  });

  it("the two surfaces are different files serving different questions", () => {
    expect(GLOBAL).not.toMatch(/useEquipmentForAccount/);
    expect(GLOBAL).toMatch(/^import .*useMetadataList/m);
  });
});

// ═════════════════════════════════════════ the global list is index-honest

describe("the global register filters on the server, not over loaded rows", () => {
  const equipmentIndexKeys = declaredIndexes.indexes
    .filter((i) => i.collectionGroup === "equipment")
    .map((i) => i.fields.map((f) => f.fieldPath).join(","));

  it("every declared filter is served by a declared composite with the default sort", () => {
    // The filters offered are accountId and status; the sort is name ASC. Firestore needs a
    // composite per filter COMBINATION, so all three must exist — including both together.
    expect(equipmentIndexList.defaultSort[0].fieldId).toBe("name");
    expect(equipmentIndexKeys).toContain("accountId,name");
    expect(equipmentIndexKeys).toContain("status,name");
    expect(equipmentIndexKeys).toContain("accountId,status,name");
  });

  it("manufacturer and model are columns and NOT filters, because no composite serves them", () => {
    const filters = equipmentIndexList.filters.map((f) => f.fieldId);
    expect(filters.sort()).toEqual(["accountId", "status"]);
    for (const fieldId of ["manufacturer", "model"]) {
      expect(equipmentIndexList.columns.map((c) => c.fieldId)).toContain(fieldId);
      expect(filters).not.toContain(fieldId);
      expect(equipmentIndexKeys.some((k) => k.startsWith(`${fieldId},`))).toBe(false);
    }
  });

  it("both filters together produce one bounded, cursor-paged descriptor", () => {
    const d = buildQueryDescriptor(equipmentIndexList, equipmentEntity, {
      filters: [
        { fieldId: "accountId", operator: "EQUALS", value: "acct-1" },
        { fieldId: "status", operator: "EQUALS", value: "ACTIVE" },
      ],
    });
    expect(d.errors).toEqual([]);
    expect(d.descriptor.limit).toBeGreaterThan(0);
    expect(d.descriptor).not.toHaveProperty("offset");
  });

  it("an undeclared filter is REFUSED, not quietly applied", () => {
    const d = buildQueryDescriptor(equipmentIndexList, equipmentEntity, {
      filters: [{ fieldId: "manufacturer", operator: "EQUALS", value: "Taylor" }],
    });
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it("the loaded-only client-side filtering is gone", () => {
    // It filtered whatever had been downloaded and said so in a note. Honest, and it still meant
    // filtering to a customer showed that customer's units ON THIS PAGE.
    expect(GLOBAL).not.toMatch(/applyLoadedFilters/);
    expect(GLOBAL).not.toMatch(/All loaded customers/);
  });
});

// ═════════════════════════════════════════ structured fields, no raw ids

describe("structured fields and human identity", () => {
  it("serial number and install date are columns again", () => {
    // The pre-migration tab rendered "S/N <value>" inline and lost it when the column was never
    // declared — the field always existed; only the column did not.
    const columns = equipmentIndexList.columns.map((c) => c.fieldId);
    expect(columns).toContain("serialNumber");
    expect(columns).toContain("installedDate");
  });

  it("the customer filter is a picker of names, never an id typed by a person", () => {
    expect(GLOBAL).toMatch(/useAccountPicker/);
    expect(GLOBAL).toMatch(/valueOptions/);
  });

  it("the id-falling-back name resolver is not called from this surface", () => {
    // installedEquipmentListView's resolveName is `nameMap.get(id) ?? id`, which is how a
    // document key reaches a screen as content.
    // Asserted on the IMPORT: the file's header explains why it no longer calls that module,
    // and a bare text search matches the explanation rather than the code.
    expect(GLOBAL).not.toMatch(/^import .*installedEquipmentListView/m);
    expect(GLOBAL).not.toMatch(/composeEquipmentRows\(/);
  });

  it("a location with no usable name resolves to nothing, never to an address or an id", () => {
    expect(pickLocationName({ name: "Airport Location" })).toBe("Airport Location");
    expect(pickLocationName({ locationName: "Legacy Site" })).toBe("Legacy Site");
    expect(pickLocationName({ label: "Bay 4" })).toBe("Bay 4");
    // An address is a different field with different disclosure rules.
    expect(pickLocationName({ address: "12 Mill Road" })).toBeNull();
    expect(pickLocationName({ name: "   " })).toBeNull();
    expect(pickLocationName(null)).toBeNull();
  });
});

// ═════════════════════════════════════════ installed vs available stay distinct

describe("installed equipment and available stock are not one status model", () => {
  it("the Available tab is a separate surface over serialized assets", () => {
    const available = read("src/modules/equipment/AvailableEquipment.jsx");
    expect(available).toMatch(/useAvailableEquipmentSource/);
    // It must not read the installed register: an available unit is not installed anywhere, and
    // merging the two would need a status value that means both.
    expect(available).not.toMatch(/^import .*equipmentIndexList/m);
  });

  // SUPERSEDED FORM, and the claim is unchanged. The original pinned the two names that carried the
  // discrete-fields composition at the time — `StructuredFields` and `availableUnitFields`. The
  // Equipment North Star P1v2.1 recomposed this surface as the locked 1b TABLE, so the composer is
  // now `availableRowCells` and the fields are cells. What is being proved is the same property it
  // was written for and the one that actually matters: five business attributes are five separate
  // things, never one concatenated string.
  it("Available Equipment renders discrete fields, not a sentence", () => {
    const available = read("src/modules/equipment/AvailableEquipment.jsx");
    expect(available).toMatch(/availableRowCells/);
    // Each attribute lands in its own labelled cell.
    for (const label of ["Unit", "Serial", "Model", "Condition", "Location"]) {
      expect(available, label).toMatch(new RegExp(`data-label="${label}"`));
    }
    // "Taylor C161 · S/N CW-C161-0001 · AVAILABLE · wh-main" put a raw location key in front of a
    // person twice — once as a place, once with a parenthetical admitting it was not one. The
    // location cell renders the composer's ABSENCE, never a stored id read off the row.
    expect(available).toMatch(/cells\.locationAbsence/);
    expect(available).not.toMatch(/\{\s*\w+\.currentLocationId/);
  });
});

// ═════════════════════════════════════════ the honest limits

describe("what the register cannot say, it registers", () => {
  const ids = () => equipmentEntity.gaps.map((g) => g.id);

  it("business line is a gap, not a column derived from the owning account", () => {
    // An account can hold equipment from BOTH operating companies — the ordinary case for a
    // customer who buys from both — so a derived value would be confidently wrong for exactly
    // the customers it matters most for.
    expect(ids()).toContain("EQUIPMENT_BUSINESS_LINE_NOT_RECORDED");
    expect(equipmentEntity.fields.some((f) => /lineOfBusiness|businessLine/i.test(f.id))).toBe(false);
    expect(equipmentIndexList.columns.some((c) => /line/i.test(c.fieldId))).toBe(false);
  });

  it("location remains displayable and unsortable, and says why", () => {
    expect(ids()).toContain("EQUIPMENT_LOCATION_NAME_NOT_PROJECTED");
    const locationField = equipmentEntity.fields.find((f) => f.id === "locationId");
    expect(locationField.sortable).not.toBe(true);
  });
});
