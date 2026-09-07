// Firestore translation of a query descriptor.
//
// The runtime decided the filters, the total sort order and the bound. What is tested
// here is that translation ADDS NOTHING and DROPS NOTHING — an invented constraint is a
// query nobody proved has an index, and a dropped one widens a read past what the caller
// asked for.

import { describe, it, expect, vi } from "vitest";

// Recorded as plain objects so a constraint list is inspectable without a database.
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ __collection: name }),
  getDocs: vi.fn(),
  query: (base, ...constraints) => ({ base, constraints }),
  where: (field, op, value) => ({ kind: "where", field, op, value }),
  orderBy: (field, dir) => ({ kind: "orderBy", field, dir }),
  limit: (n) => ({ kind: "limit", n }),
  startAfter: (doc) => ({ kind: "startAfter", doc }),
  documentId: () => "__name__",
}));
vi.mock("../src/firebase/firebase", () => ({ db: {} }));

const { toConstraints } = await import("../src/metadata/firestoreListSource.js");

const descriptor = (over = {}) => ({
  collection: "accounts",
  filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }],
  sort: [{ fieldId: "updatedAt", direction: "DESC" }, { fieldId: "__name__", direction: "ASC" }],
  limit: 51,
  pageSize: 50,
  ...over,
});

const kinds = (c, kind) => c.filter((x) => x.kind === kind);

describe("toConstraints", () => {
  it("translates declared filters, and nothing else", () => {
    const c = toConstraints(descriptor());
    expect(kinds(c, "where")).toEqual([{ kind: "where", field: "status", op: "==", value: "ACTIVE" }]);
  });

  it("preserves the total sort order, tiebreaker last", () => {
    // Reordering here would break cursor paging in a way that silently drops and
    // duplicates rows rather than failing.
    const c = kinds(toConstraints(descriptor()), "orderBy");
    expect(c.map((x) => x.field)).toEqual(["updatedAt", "__name__"]);
    expect(c[0].dir).toBe("desc");
  });

  it("always applies the bound, and applies the runtime's +1 probe unchanged", () => {
    // The probe is how truncation is DETECTED. Trimming it here would make hasMore
    // permanently false and the last page permanently the only page.
    expect(kinds(toConstraints(descriptor()), "limit")).toEqual([{ kind: "limit", n: 51 }]);
  });

  it("there is no unbounded path — a descriptor without a limit is not something the runtime produces", () => {
    // buildQueryDescriptor clamps rather than omits, so this asserts the translator does
    // not quietly invent an unbounded read if it ever received one.
    const c = toConstraints(descriptor({ limit: undefined }));
    expect(kinds(c, "limit")).toHaveLength(1);
  });

  it("a cursor is applied as startAfter, before the limit", () => {
    const c = toConstraints(descriptor(), { __doc: true });
    const order = c.map((x) => x.kind);
    expect(order.indexOf("startAfter")).toBeLessThan(order.indexOf("limit"));
  });

  it("no cursor means no startAfter — a first page starts at the beginning", () => {
    expect(kinds(toConstraints(descriptor()), "startAfter")).toHaveLength(0);
  });

  it("an operator with no Firestore equivalent throws rather than being dropped", () => {
    // Dropping it would widen the query to rows the caller never asked for, silently.
    expect(() => toConstraints(descriptor({ filters: [{ fieldId: "x", operator: "MATCHES_REGEX", value: 1 }] })))
      .toThrow(/no Firestore equivalent/);
  });

  it("maps the array operators the contract declares", () => {
    const c = toConstraints(descriptor({ filters: [{ fieldId: "tags", operator: "ARRAY_CONTAINS", value: "vip" }] }));
    expect(kinds(c, "where")[0].op).toBe("array-contains");
  });
});

// ════════════════════ THE STORAGE IDENTITY WINS ════════════════════
//
// A CURRENT PRODUCTION DEFECT, independent of any migration. fetchPage composed rows as
// `{ id: d.id, ...d.data() }` -- id FIRST -- so a document carrying its own stored `id` field
// silently replaced the authoritative Firestore document id in every metadata-driven list,
// including Users.
//
// That value is not cosmetic: the runtime keys rows by it, MetadataListGrid routes clicks by it,
// and a record page is opened by it. A stored id that disagrees would send a click to the wrong
// record, or to none, with nothing on screen saying so.
//
// This is a correctness question about which of two ids a reader is handed, and the answer is the
// one the database guarantees. It is not a field-security question and does not anticipate one.
describe("fetchPage row identity", () => {
  it("a stored `id` field can never override the Firestore document id", async () => {
    const { getDocs } = await import("firebase/firestore");
    getDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "AUTHORITATIVE",
          data: () => ({ id: "CONFLICTING", name: "Acme" }),
        },
      ],
    });

    const { fetchPage } = await import("../src/metadata/firestoreListSource.js");
    const page = await fetchPage(descriptor({ limit: 2, pageSize: 1 }));

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].id).toBe("AUTHORITATIVE");
    expect(page.rows[0].id).not.toBe("CONFLICTING");
    // The rest of the document still arrives -- this is about precedence, not about dropping data.
    expect(page.rows[0].name).toBe("Acme");
  });
});
