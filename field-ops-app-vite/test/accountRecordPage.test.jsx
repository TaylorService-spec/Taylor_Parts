// THE SHARED RECORD PAGE — ACCOUNT AS THE PROVING SURFACE.
//
// GOVERNANCE: Owner package "UX CORE RECORD PAGE — ACCOUNT PROVING SURFACE", 2026-08-24.
//
// ============================ WHAT THIS PACKAGE COULD HAVE GOT WRONG ============================
//
// The record page is where a metadata layer either pays off or turns decorative. The two failures
// worth guarding are opposite in shape:
//
//   1. A page that shows fields it cannot honestly show — a raw document id where a business label
//      belongs, a blank cell where "no value" belongs, an "[object Object]" where an address does.
//   2. A page that offers an edit it has no authority to perform — a pencil beside a field no
//      command writes, or beside a field this viewer specifically may not change.
//
// Everything below is one of those two.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { accountEntity, ACCOUNT_GOVERNED_FIELD_IDS } from "../src/metadata/definitions/account.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import { fieldEditability, EDITABILITY_REASON_TEXT } from "../src/metadata/pageDefinition.js";
import { ACCOUNT_FIELD_INPUT_ID } from "../src/modules/accounts/accountFieldInputs.js";
import { FIELD_TYPE } from "../src/metadata/entityDefinition.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const SHELL = read("src/metadata/MetadataRecordPage.jsx");
const DETAIL = read("src/modules/accounts/AccountDetail.jsx");
const FORM = read("src/modules/accounts/AccountForm.jsx");
const RULES = read("../firestore.rules");
const CSS = read("src/index.css");

const fieldGroups = accountRecordPage.sections.filter((s) => s.kind === "FIELD_GROUP");
const pageFieldIds = new Set(fieldGroups.flatMap((s) => s.fieldIds ?? []));

// ═════════════════════════════════════════ 1 · renders through the shared shell

describe("Account renders through the shared record shell", () => {
  it("the detail page mounts MetadataRecordPage rather than hand-writing field rows", () => {
    expect(DETAIL).toMatch(/^import MetadataRecordPage/m);
    expect(DETAIL).toMatch(/<MetadataRecordPage/);
  });

  it("the shell owns the field rendering, so a second object inherits it unchanged", () => {
    // The whole point of a shared shell: the layout lives in ONE component. If a screen started
    // emitting its own field grid, the next object would inherit nothing.
    expect(SHELL).toMatch(/fo-record-fields/);
    expect(DETAIL).not.toMatch(/fo-record-fields/);
  });
});

// ═════════════════════════════════════════ 2 · two columns, derived, responsive

describe("the two-column field layout is derived from metadata and collapses", () => {
  it("field groups come from the page definition, not from the screen", () => {
    expect(fieldGroups.length).toBeGreaterThanOrEqual(4);
    for (const section of fieldGroups) {
      expect(section.fieldIds.length, `${section.id} must declare its fields`).toBeGreaterThan(0);
      // A section with no label renders a humanized id, which is a fallback and not a business
      // name. Every group this package touches names itself.
      expect(section.label, `${section.id} needs a business label`).toBeTruthy();
    }
  });

  it("each label/value pair is ONE grid cell, so the columns do not split into labels-then-values", () => {
    expect(SHELL).toMatch(/<div className="fo-record-field" key=/);
    expect(CSS).toMatch(/\.fo-record-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  });

  it("it collapses to a single column at the phone breakpoint", () => {
    // Two columns of stacked fields at 375px gives each value ~160px, which wraps a customer
    // name to three lines.
    expect(CSS).toMatch(/@media \(max-width: 640px\) \{\s*\.fo-record-fields \{ grid-template-columns: minmax\(0, 1fr\)/);
  });

  it("a long value wraps instead of pushing the page into horizontal scroll", () => {
    expect(CSS).toMatch(/\.fo-record-field__value\s*\{[\s\S]*?overflow-wrap: anywhere/);
    expect(CSS).toMatch(/\.fo-record-field \{ display: block; min-width: 0; \}/);
  });
});

// ═════════════════════════════════════════ 3 · truthful nulls

describe("a missing value renders truthfully", () => {
  it("renders an em dash and marks the cell as absent, never a blank", () => {
    // A blank cell says nothing at all and reads as a rendering bug; an em dash says "there is no
    // value here", which is a fact about the record.
    expect(SHELL).toMatch(/isMissing: value === null \|\| value === undefined \|\| value === ""/);
    expect(SHELL).toMatch(/\? "—" :/);
    expect(SHELL).toMatch(/item\.isMissing \? "fo-record-field__value fo-muted"/);
  });
});

// ═════════════════════════════════════════ 4 · resolved label beats raw id

describe("a resolved business label wins over a raw id", () => {
  it("an unresolved REFERENCE renders a label, never the stored document key", () => {
    // DECISIONS #106. The shell routes REFERENCE fields through listPresentation's fail-closed
    // default rather than printing the id when a resolver has no answer.
    expect(SHELL).toMatch(/UNRESOLVED_REFERENCE_LABEL|Unresolved reference/);
    expect(SHELL).not.toMatch(/String\(record\[fieldId\]\)/);
  });

  it("ADDRESS is formatted by the one address formatter, not stringified", () => {
    // `String({street: ...})` renders "[object Object]" — the exact class of defect this renderer
    // exists to prevent.
    expect(SHELL).toMatch(/^import \{ formatAddress \}/m);
    expect(SHELL).toMatch(/field\?\.type === "ADDRESS"/);
  });

  it("billingAddress is a DECLARED field now, not read around the metadata layer", () => {
    // It has been stored and written by AccountForm since the Commercial Profile work and had no
    // FieldDefinition, so the page could only render it by reaching past metadata.
    const field = accountEntity.fields.find((f) => f.id === "billingAddress");
    expect(field).toBeTruthy();
    expect(field.type).toBe("ADDRESS");
    expect(FIELD_TYPE).toContain("ADDRESS");
    expect(pageFieldIds.has("billingAddress")).toBe(true);
  });
});

// ═════════════════════════════════════════ 5/6 · editability is an allowlist

describe("editability comes from the governed command, not from optimism", () => {
  it("every editable field is one the existing form actually sends", () => {
    // THE LOAD-BEARING TEST. The allowlist is compared against the payload AccountForm builds, so
    // a field cannot be declared editable because somebody hoped it was.
    const payloadBlock = FORM.slice(FORM.indexOf("const payload = {"), FORM.indexOf("};", FORM.indexOf("const payload = {")));
    // Matches BOTH `key: value` and the shorthand `key,` — the payload uses both, and a pattern
    // that only saw the colon form reported `status` as never sent while the form sends it.
    const sent = new Set(
      [...payloadBlock.matchAll(/^\s+([a-zA-Z]+)\s*(?::|,\s*$)/gm)].map((m) => m[1]),
    );
    // Two declared fields map onto differently-named payload keys, which is a real shape
    // difference between the stored document and the metadata, not a miss:
    const ALIAS = { billingContactId: "billingContact", accountOwnerEmployeeId: "accountOwner" };
    for (const fieldId of accountRecordPage.editableFieldIds) {
      const key = ALIAS[fieldId] ?? fieldId;
      expect(sent.has(key), `${fieldId} is declared editable but AccountForm never sends it`).toBe(true);
    }
  });

  it("names the authority that would write, so no page claims an edit anonymously", () => {
    expect(accountRecordPage.writeCommand).toBe("domain/accounts.js#updateAccount");
  });

  it("a READ-ONLY field cannot enter edit mode, and is not hidden either", () => {
    for (const fieldId of ["createdAt", "updatedAt", "nameLower"]) {
      const verdict = fieldEditability(accountRecordPage, fieldId);
      expect(verdict.editable, `${fieldId} must not be editable`).toBe(false);
      expect(EDITABILITY_REASON_TEXT[verdict.reason]).toBeTruthy();
    }
    // createdAt/updatedAt STAY ON THE PAGE. The reason a field cannot be edited is usually worth
    // seeing, and "when was this last touched" is exactly what a stale-looking record needs.
    expect(pageFieldIds.has("createdAt")).toBe(true);
    expect(pageFieldIds.has("updatedAt")).toBe(true);
  });

  it("the two governed fields are admin-only, mirroring Rules rather than restating it", () => {
    // firestore.rules accountGovernedFieldsUnchanged(): a dispatcher may update only if these are
    // unchanged. Asserted against the rule text so the mirror cannot drift from the enforcement.
    for (const fieldId of ACCOUNT_GOVERNED_FIELD_IDS) {
      expect(RULES).toMatch(new RegExp(`request\\.resource\\.data\\.get\\('${fieldId}'`));
      expect(fieldEditability(accountRecordPage, fieldId, { isAdmin: false, adminOnlyFieldIds: ACCOUNT_GOVERNED_FIELD_IDS }))
        .toEqual({ editable: false, reason: "ADMIN_ONLY" });
      expect(fieldEditability(accountRecordPage, fieldId, { isAdmin: true, adminOnlyFieldIds: ACCOUNT_GOVERNED_FIELD_IDS }).editable)
        .toBe(true);
    }
  });

  it("the shell renders no pencil at all when the caller supplies no handler", () => {
    // The shell has no write authority of its own; a page that cannot route an edit must not
    // advertise one.
    expect(SHELL).toMatch(/item\.editable && onEditField &&/);
  });
});

// ═════════════════════════════════════════ 7/8/9 · save, cancel, denial

describe("saving goes through the existing governed path and nothing else", () => {
  it("the shell itself never writes", () => {
    for (const forbidden of ["updateDoc", "setDoc", "addDoc", "deleteDoc", "writeBatch"]) {
      expect(SHELL, `the record shell must not ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\s*\\(`));
    }
  });

  it("Account saves through updateAccount, never a direct Firestore write", () => {
    expect(DETAIL).toMatch(/^import \{ updateAccount \}/m);
    expect(DETAIL).toMatch(/await updateAccount\(account\.id, values\)/);
    for (const forbidden of ["updateDoc", "setDoc", "addDoc"]) {
      expect(DETAIL).not.toMatch(new RegExp(`\\b${forbidden}\\s*\\(`));
    }
  });

  it("a blocked write THROWS, so the form keeps the values instead of closing as if saved", () => {
    // This is a fix that already shipped and must not regress: a denied write once fell through
    // to setIsEditing(false), closing the form as though it had committed.
    expect(DETAIL).toMatch(/result\?\.blocked|blocked/);
    expect(FORM).toMatch(/setSaveError\(accountSaveErrorMessage\(err\)\)/);
  });

  it("Cancel closes edit mode and writes nothing", () => {
    expect(DETAIL).toMatch(/onCancel=\{\(\) => \{ setIsEditing\(false\); setFocusFieldId\(null\); \}\}/);
  });

  it("a pencil opens the SAME governed form, focused on the field", () => {
    // Not a per-field write path: there is none, and this does not invent one.
    expect(DETAIL).toMatch(/setFocusFieldId\(fieldId\)/);
    expect(DETAIL).toMatch(/focusFieldId=\{focusFieldId\}/);
    expect(FORM).toMatch(/ACCOUNT_FIELD_INPUT_ID\[focusFieldId\]/);
  });

  it("every mapped focus target is a control the form really has", () => {
    // A map that rots into pointing at renamed controls would steal focus to nothing.
    for (const [fieldId, inputId] of Object.entries(ACCOUNT_FIELD_INPUT_ID)) {
      expect(FORM, `${fieldId} -> #${inputId} is not in AccountForm`).toMatch(new RegExp(`id="${inputId}"`));
      expect(accountRecordPage.editableFieldIds).toContain(fieldId);
    }
  });
});

// ═════════════════════════════════════════ 10/11/12 · nothing became unreachable

describe("the existing Account surfaces stay reachable", () => {
  it("related navigation, contacts, locations and activity all survive", () => {
    for (const sectionId of ["contacts", "locations", "opportunities", "salesOrders", "activityAndNotes", "serviceActivity"]) {
      expect(
        accountRecordPage.sections.some((s) => s.id === sectionId),
        `${sectionId} disappeared from the Account page`,
      ).toBe(true);
    }
  });

  it("Back to Customers still returns to the list somebody had", () => {
    expect(DETAIL).toMatch(/objectListPathWithState\(OBJECT_LIST_KEY\.CUSTOMERS/);
  });

  it("the governed Edit action is still offered", () => {
    expect(DETAIL).toMatch(/onClick=\{\(\) => setIsEditing\(true\)\}/);
  });

  it("EquipmentRegister remains account-scoped and is not pulled into this page", () => {
    // §7 scopes it deliberately, and its create flow needs one fixed Account.
    const register = read("src/modules/equipment/EquipmentRegister.jsx");
    expect(register).toMatch(/useEquipmentForAccount/);
    expect(register).not.toMatch(/^import .*useMetadataList/m);
  });
});

// ═════════════════════════════════════════ 13 · drift

describe("a record page cannot be mounted without a declared definition", () => {
  it("every object mounting the shell names a page definition", () => {
    // The same governance shape as the list manifest: the screen files are read, so a new object
    // cannot quietly mount the shell against nothing.
    const mounts = ["src/modules/accounts/AccountDetail.jsx", "src/modules/sales/SalesWorkspace.jsx"];
    for (const file of mounts) {
      const src = read(file);
      if (!/<MetadataRecordPage/.test(src)) continue;
      expect(src, `${file} mounts the record shell with no definition= prop`).toMatch(/definition=\{/);
    }
  });

  it("the Account page covers every displayable field it declares", () => {
    // 20 declared, 1 deliberately hidden (nameLower is a derived search key), 20 displayable.
    const displayable = accountEntity.fields.filter((f) => f.displayable !== false);
    const missing = displayable.filter((f) => !pageFieldIds.has(f.id)).map((f) => f.id);
    expect(missing, "a declared, displayable field renders nowhere on its own record").toEqual([]);
    expect(accountEntity.fields.find((f) => f.id === "nameLower").displayable).toBe(false);
  });
});
