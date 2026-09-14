// RPT-FIX shared harness for the emulator-free report-engine tests.
//
// Baseline: branch post/eng-e-report-scope @ 92db1d19 (parent main
// @ 64008d5ae0bdd9532909671b15a91122400accf1 = ATLAS-BASE-2026-09-12-A).
//
// Extracted rather than copied because TWO test files need the identical
// synthetic world and Firestore double (reportFalseEmptyHonesty.test.mjs and
// reportAuditContextInjection.test.mjs), and a second hand-maintained copy of a
// double that MODELS FIRESTORE'S ORDERING is exactly the kind of thing that
// drifts and then quietly stops proving anything.
//
// This module deliberately does NOT import the service under test. The audit
// test installs a module-loader trap BEFORE importing the service, so anything
// that pulls firebase-admin in early would defeat that proof.
//
// The double follows reportRowScopeBound.test.mjs's: it records every query
// with its predicate list and every document read, IN ORDER, and applies
// server-side predicates BEFORE the limit -- which is what makes a real bound
// distinguishable from an in-memory post-filter. It additionally records audit
// writes, so "the audit event landed on THIS db" is an observation rather than
// an inference.

export const AUDIT_COLLECTION = "auditEvents";

function atPath(row, path) {
  return String(path)
    .split(".")
    .reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), row);
}

export function makeRecordingDb(world) {
  const log = [];
  const auditWrites = [];
  let autoSeq = 0;

  const mkDocRef = (collection, id) => {
    const docId = id ?? `auto-${(autoSeq += 1)}`;
    return {
      id: docId,
      path: `${collection}/${docId}`,
      collection: { id: collection },
      __collection: collection,
      async get() {
        log.push({ kind: "docGet", collection, docId });
        const d = (world[collection] ?? {})[docId];
        return { id: docId, exists: d !== undefined, data: () => d };
      },
    };
  };

  const mkQuery = (collection, predicates, limit) => ({
    where(field, op, value) {
      return mkQuery(collection, [...predicates, { field, op, value }], limit);
    },
    limit(n) {
      return mkQuery(collection, predicates, n);
    },
    async get() {
      log.push({ kind: "query", collection, predicates: [...predicates], limit });
      let rows = Object.entries(world[collection] ?? {}).map(([id, d]) => ({ id, ...d }));
      // Firestore order: SERVER-SIDE predicates first, THEN the limit.
      for (const p of predicates) {
        rows = rows.filter((r) => {
          const v = atPath(r, p.field);
          if (p.op === "==") return v === p.value;
          if (p.op === "in") return Array.isArray(p.value) && p.value.includes(v);
          throw new Error(`the double does not model operator ${p.op}`);
        });
      }
      const capped = typeof limit === "number" ? rows.slice(0, limit) : rows;
      return {
        size: capped.length,
        docs: capped.map((r) => ({
          id: r.id,
          exists: true,
          data: () => {
            const { id, ...rest } = r;
            return rest;
          },
        })),
      };
    },
    doc(id) {
      return mkDocRef(collection, id);
    },
  });

  return {
    log,
    auditWrites,
    collection(name) {
      return mkQuery(name, [], undefined);
    },
    async runTransaction(fn) {
      const staged = [];
      const txn = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          staged.push({ ref, data });
        },
        create(ref, data) {
          staged.push({ ref, data });
        },
        update(ref, data) {
          staged.push({ ref, data });
        },
        delete(ref) {
          staged.push({ ref, data: null });
        },
      };
      const result = await fn(txn);
      for (const s of staged) {
        log.push({ kind: "write", collection: s.ref?.__collection, docId: s.ref?.id });
        if (s.ref?.__collection === AUDIT_COLLECTION) auditWrites.push(s.data);
      }
      return result;
    },
    batch() {
      const staged = [];
      return {
        set(ref, data) {
          staged.push({ ref, data });
        },
        create(ref, data) {
          staged.push({ ref, data });
        },
        update() {},
        delete() {},
        async commit() {
          for (const s of staged) {
            log.push({ kind: "write", collection: s.ref?.__collection, docId: s.ref?.id });
            if (s.ref?.__collection === AUDIT_COLLECTION) auditWrites.push(s.data);
          }
        },
      };
    },
  };
}

export function queriesOf(db, collection) {
  return db.log.filter((e) => e.kind === "query" && e.collection === collection);
}
export function docGetsOf(db, collection) {
  return db.log.filter((e) => e.kind === "docGet" && e.collection === collection);
}

// ---------------------------------------------------------------------------
// The synthetic world -- the same shape reportRowScopeBound.test.mjs uses, so
// the two files cannot disagree about what the engine is being shown.
// ---------------------------------------------------------------------------

// Exactly the 25 report.* ids config/environments.json activates on
// taylor-parts-production.
export const PRODUCTION_ACTIVATED_REPORT_CAPS = Object.freeze([
  "report.customer.read",
  "report.contact.read",
  "report.location.read",
  "report.equipment.read",
  "report.definition.read",
  "report.customer.field.name.read",
  "report.customer.field.status.read",
  "report.customer.field.relationshipTypes.read",
  "report.customer.field.tags.read",
  "report.customer.field.createdAt.read",
  "report.customer.field.commercialProfile.read",
  "report.customer.field.billingContact.read",
  "report.contact.field.name.read",
  "report.contact.field.role.read",
  "report.contact.field.customer.read",
  "report.location.field.name.read",
  "report.location.field.address.read",
  "report.location.field.customer.read",
  "report.equipment.field.name.read",
  "report.equipment.field.status.read",
  "report.equipment.field.identity.read",
  "report.equipment.field.dates.read",
  "report.equipment.field.customer.read",
  "report.equipment.field.location.read",
  "report.equipment.field.createdAt.read",
]);

// Test-only Role map -- the real catalogs are frozen; this is the `roles` seam
// reportExecutionService already exposes for exactly this.
export const SYNTH_ROLES = Object.freeze({
  synthReportRunner: Object.freeze({
    id: "synthReportRunner",
    name: "Synthetic report runner",
    description: "test-only",
    permissions: Object.freeze([...PRODUCTION_ACTIVATED_REPORT_CAPS]),
  }),
});

// A Role holding the object capability but NOT equipment.status -- used to make
// a run simultaneously partially-authorized and bounded, so the orthogonality of
// the completeness axis can be observed.
export const SYNTH_ROLES_NO_STATUS = Object.freeze({
  synthReportRunner: Object.freeze({
    id: "synthReportRunner",
    name: "Synthetic report runner (no status field)",
    description: "test-only",
    permissions: Object.freeze(
      PRODUCTION_ACTIVATED_REPORT_CAPS.filter((c) => c !== "report.equipment.field.status.read"),
    ),
  }),
});

function assignment(id, principalUid, scope) {
  return {
    id,
    principalUid,
    roleId: "synthReportRunner",
    scope,
    status: "active",
    accessVersionAtGrant: 3,
    grantedBy: "test",
  };
}

// `taylorRows` lets a test seed MANY same-company documents, which is what makes
// a scan-truncated page with a matching row OUTSIDE the page constructible.
export function world({ taylorRows = 1 } = {}) {
  const equipment = {};
  for (let i = 1; i <= taylorRows; i += 1) {
    equipment[`eq-t${i}`] = {
      name: `T${i}`,
      // Only the LAST seeded Taylor row is "retired". With a scan cap smaller
      // than taylorRows it is outside the loaded page, so an in-memory
      // `status == retired` filter finds nothing -- the false-empty reproduction.
      status: i === taylorRows && taylorRows > 1 ? "retired" : "active",
      operatingCompanyId: "taylor",
      accountId: "acc-1",
      locationId: "loc-1",
    };
  }
  equipment["eq-v1"] = {
    name: "V1",
    status: "active",
    operatingCompanyId: "ventana",
    accountId: "acc-2",
    locationId: "loc-2",
  };
  equipment["eq-orphan"] = { name: "ORPHAN", status: "active", accountId: "acc-3", locationId: "loc-3" };
  return {
    users: {
      "u-global": { accessVersion: 3 },
      "u-taylor": { accessVersion: 3 },
      "u-ventana": { accessVersion: 3 },
      "u-location": { accessVersion: 3 },
      "u-none": { accessVersion: 3 },
    },
    roleAssignments: {
      "ra-global": assignment("ra-global", "u-global", { type: "global" }),
      "ra-taylor": assignment("ra-taylor", "u-taylor", { type: "operatingCompany", value: "taylor" }),
      "ra-ventana": assignment("ra-ventana", "u-ventana", { type: "operatingCompany", value: "ventana" }),
      // A REAL grant bound to no governed operating company -- ENG-E's
      // `company-unresolved` path.
      "ra-location": assignment("ra-location", "u-location", { type: "location", value: "phx-1" }),
    },
    equipment,
    accounts: { "acc-1": { name: "A1" }, "acc-2": { name: "A2" }, "acc-3": { name: "A3" } },
    locations: { "loc-1": { name: "L1" }, "loc-2": { name: "L2" }, "loc-3": { name: "L3" } },
    contacts: { "c-1": { name: "C1", role: "buyer", accountId: "acc-1" } },
  };
}

export const EQUIPMENT_DEF = {
  objectId: "equipment",
  fields: ["equipment.name", "equipment.status"],
};

// The false-empty definition: a filter that MATCHES a real document which lives
// beyond the bounded page.
export const EQUIPMENT_RETIRED_DEF = {
  objectId: "equipment",
  fields: ["equipment.name", "equipment.status"],
  filters: [{ fieldId: "equipment.status", op: "eq", value: "retired" }],
};

export const EQUIPMENT_RETIRED_GROUPED_DEF = {
  objectId: "equipment",
  fields: ["equipment.status"],
  filters: [{ fieldId: "equipment.status", op: "eq", value: "retired" }],
  groupBy: ["equipment.status"],
};

export const EQUIPMENT_COUNT_DEF = {
  objectId: "equipment",
  fields: [],
  aggregates: [{ fn: "countRows" }],
};

// The production activation set is resolved from GCLOUD_PROJECT at cold start
// and cached, so it must be pinned before the service module is imported.
export function pinProductionActivationProject() {
  process.env.GCLOUD_PROJECT = "taylor-parts";
}
