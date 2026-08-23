// DETERMINISTIC WORLD CONSTRUCTION. Pure: no database, no clock, no randomness.
//
// Everything is a function of a fixed input list and an index, so buildWorld() called twice returns
// byte-identical records. That is what makes "seed twice, expect zero creates" a meaningful assertion
// rather than a hope, and what makes a diff between two seeds evidence of a real change.
//
// TIME IS PINNED for the same reason. A dataset stamped with Date.now() is a different dataset every
// run, which would make idempotence unprovable and every count drift-prone.
import { CERTIFICATION_WORLD_VERSION, PROVENANCE, SYNTHETIC_OWNERSHIP_DISCLAIMER, marker } from "./manifest.mjs";
import { REAL_BUSINESSES, syntheticBusinesses, FIELD_PROVENANCE } from "./data/accounts.mjs";
import { TAYLOR_MODELS, ICETRO_MODELS, ALL_MODELS, modelIdOf } from "./data/equipmentMasters.mjs";
import { CERT_TRUCKS, stateForIndex, partsRoomQtyFor, truckAllocationFor, INVENTORY_STATE } from "./data/inventory.mjs";
import { buildWorkforce } from "./data/workforce.mjs";
import { buildTechnicianRecords, buildJobRecords } from "./data/workforceLoad.mjs";
import { equipmentForAccount } from "./data/equipmentAssets.mjs";
import { CERT_PARTS, partRecordFor } from "./data/partsCatalog.mjs";
import { WHOLE_UNIT_PARTS, wholeUnitPartRecordFor } from "./data/wholeUnitParts.mjs";
import {
  ACCOUNT_STATUS_VALUES,
  ACCOUNT_RELATIONSHIP_VALUES,
  normalizeNameForSearch,
} from "./domainContracts.mjs";

const FLEET_RECORD_AUTHOR = "certification-world-builder";

export const EPOCH = Date.parse("2026-01-05T09:00:00.000Z");
export const DAY = 86400000;
export const SYNTHETIC_ACCOUNT_COUNT = 75;

const pad = (n, w = 4) => String(n).padStart(w, "0");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, "").slice(0, 40);

// Deliberate visual-stress values, applied to a SMALL NAMED subset. A dataset that is uniformly
// pathological tests nothing about normal use and makes every screenshot unreadable.
const STRESS_SUFFIX = " Hospitality Holdings and Restaurant Management Group of the Greater Phoenix Metropolitan Area, LLC";
const STRESS_NOTE = "Extended operational note retained for visual-stress certification. This record deliberately carries a long free-text body so that detail panels, table cells, truncation rules, wrapping behaviour and overflow containers are exercised against realistic worst-case content rather than short fixture strings that never reveal a layout defect.";

const FIRST = ["Dana", "Alex", "Sam", "Jordan", "Riley", "Casey"];
const LAST = ["Reyes", "Chen", "Patel", "Okafor", "Nguyen", "Alvarez"];
const TITLES = ["General Manager", "Operations Lead", "Facilities Manager", "Owner"];

// ============================ RELATIONSHIP SPREAD ============================
//
// `relationshipTypes` is an OPTIONAL, additive, informational array: an Account may be a customer,
// a vendor, both, or unstated. The domain is explicit that unset renders no badge and must never
// silently default to "Customer", so UNSET IS A REAL STATE and the world has to contain some -- a
// fixture set where every record is populated cannot prove that the unset case is handled.
//
// Every cert account previously had NO value, which made the Relationship filter unexercisable:
// filtering by Customer returned almost nothing, and no vendor existed anywhere in the world.
//
// Deterministic by index, and deliberately NOT uniform:
//
//   ~8%  VENDOR only            -- a supplier that is not a customer
//   ~8%  CUSTOMER + VENDOR      -- both at once, which the array shape exists to express
//   ~8%  unset                  -- the valid "not stated" case, preserved on purpose
//   rest CUSTOMER               -- the ordinary majority
//
// The moduli are coprime with the status/line spreads above so the categories cross-cut rather than
// stacking onto the same records, which is what makes a filter combination meaningful to test.
function relationshipTypesFor(i) {
  if (i % 13 === 5) return [ACCOUNT_RELATIONSHIP_VALUES.VENDOR];
  if (i % 13 === 9) return [ACCOUNT_RELATIONSHIP_VALUES.CUSTOMER, ACCOUNT_RELATIONSHIP_VALUES.VENDOR];
  if (i % 13 === 11) return null; // unset: a state the domain permits and the UI must not misread
  return [ACCOUNT_RELATIONSHIP_VALUES.CUSTOMER];
}

export function buildWorld() {
  const accounts = [];
  const locations = [];
  const contacts = [];
  const equipmentModels = [];
  const equipment = [];
  // ONE `parts` collection, two kinds of Part. The service catalog is what machines consume; the
  // whole-unit catalog is the machines. They are appended rather than merged into one generator
  // because they answer to different rules -- a whole-unit Part must be SERIALIZED and carries an
  // equipment-model FK, neither of which is true of a drive belt -- and because the inventory
  // condition spread is keyed on the SERVICE catalog's index. Prepending these would shift every
  // service part's condition by eight and silently rewrite the six inventory scenarios.
  const parts = [...CERT_PARTS.map(partRecordFor), ...WHOLE_UNIT_PARTS.map(wholeUnitPartRecordFor)];
  const trucks = [];
  const employees = [];

  // EQUIPMENT MODELS ARE REGISTRY RECORDS, NOT FIXTURE ROWS.
  //
  // `equipment_models` belongs to the Equipment Compatibility registry, and the registry's reader
  // (`modelFromFirestore`) enforces three things this world used to satisfy none of: the document id
  // must be canonical, the stored `equipmentModelId` must EQUAL that id, and the record must pass D1
  // validation -- which requires `manufacturerId`, `manufacturerName`, `displayName`,
  // `sourceAuthority` and an integer `version`. See data/equipmentMasters.mjs for how that went
  // unnoticed and why it stopped being ignorable.
  //
  // The public catalog citation moves into `sourceAuthority`, which is the field that exists to
  // carry exactly that, and the configuration descriptor into `subtype`. `lineOfBusiness` is kept
  // even though the registry does not define it: the reader selects fields by name rather than
  // rejecting extras, and it is the field the Taylor/Ventana reporting separation is measured on.
  for (const m of ALL_MODELS) {
    const id = modelIdOf(m);
    equipmentModels.push({
      collection: "equipment_models",
      id,
      data: {
        equipmentModelId: id,
        manufacturerId: id.split("--")[0],
        manufacturerName: m.manufacturer,
        modelNumber: m.modelNumber,
        displayName: `${m.manufacturer} ${m.modelNumber}`,
        family: m.family,
        subtype: m.config,
        revision: null,
        status: "ACTIVE",
        sourceAuthority: m.manufacturer === "Taylor"
          ? "taylor-company.com/equipment/soft-serve-fro-yo/ (retrieved 2026-08-21)"
          : "icetroamerica.com product listings (retrieved 2026-08-21)",
        version: 1,
        lineOfBusiness: m.lineOfBusiness,
        fieldProvenance: { modelNumber: PROVENANCE.PUBLIC, manufacturerName: PROVENANCE.PUBLIC, family: PROVENANCE.PUBLIC, subtype: PROVENANCE.PUBLIC },
        createdBy: FLEET_RECORD_AUTHOR,
        updatedBy: FLEET_RECORD_AUTHOR,
      },
    });
  }

  const businesses = [
    ...REAL_BUSINESSES.map((b) => ({ ...b, real: true })),
    ...syntheticBusinesses(SYNTHETIC_ACCOUNT_COUNT).map((b) => ({ ...b, real: false })),
  ];

  businesses.forEach((b, i) => {
    // Deterministic spread so the Taylor/Ventana reporting separation has all three shapes to measure.
    const lineMode = i % 5 === 0 ? "MIXED" : i % 3 === 0 ? "VENTANA" : "TAYLOR";
    const isStress = i === 3 || i === 41;
    const isSparse = i % 17 === 0 && !b.real;
    const accountId = "cw-acct-" + pad(i);
    const name = isStress ? b.name + STRESS_SUFFIX : b.name;

    const acct = {
      name,
      // Derived, never displayed. Firestore cannot compare case-insensitively, so the search box
      // queries this copy; see domain/nameNormalization.js for why it is one shared function.
      nameLower: normalizeNameForSearch(name),
      lineOfBusiness: lineMode === "MIXED" ? "TAYLOR" : lineMode,
      certLineMode: lineMode,
      // DORMANT WAS FIXTURE DRIFT. The canonical statuses are ACTIVE/INACTIVE/PROSPECT/ARCHIVED;
      // "DORMANT" existed only here, so the portfolio summary refused to bucket those 5 records
      // (correctly -- it never guesses a status a record does not have) and the screen reported
      // that the categories did not add up. The UI was right and the data was wrong.
      status: i % 23 === 0 ? ACCOUNT_STATUS_VALUES.INACTIVE : ACCOUNT_STATUS_VALUES.ACTIVE,
      category: b.category,
      city: b.city, state: "AZ",
      fixtureCompleteness: isSparse ? "SPARSE" : "FULL_FIXTURE",
      dataProvenance: b.real ? PROVENANCE.PUBLIC : PROVENANCE.SYNTHETIC,
      fieldProvenance: b.real ? FIELD_PROVENANCE.real : FIELD_PROVENANCE.synthetic,
    };
    const rel = relationshipTypesFor(i);
    if (rel) acct.relationshipTypes = rel;

    if (!isSparse) {
      acct.addressLine1 = (1000 + i * 7) + " W Certification Way";
      acct.phone = "602-555-" + pad(1000 + i, 4);
      acct.website = "https://" + slug(b.name) + ".invalid";
      acct.notes = isStress ? STRESS_NOTE : "Certification account " + i + ".";
    }
    if (b.real) {
      acct.publicSource = "public business listings (Yelp / Phoenix New Times / Axios / VisitPhoenix), retrieved 2026-08-21";
      acct.syntheticDataDisclaimer = SYNTHETIC_OWNERSHIP_DISCLAIMER;
    }
    accounts.push({ collection: "accounts", id: accountId, data: acct });

    const locCount = isStress ? 12 : b.locations;
    for (let L = 0; L < locCount; L += 1) {
      const locationId = accountId + "-loc-" + pad(L, 2);
      locations.push({
        collection: "locations", id: locationId,
        data: {
          accountId,
          name: b.name + " - " + b.city + " #" + (L + 1) + (isStress ? STRESS_SUFFIX : ""),
          city: b.city, state: "AZ",
          addressLine1: (2000 + i * 3 + L) + " E Certification Blvd",
          fieldProvenance: {
            city: PROVENANCE.PUBLIC, state: PROVENANCE.PUBLIC,
            name: b.real ? PROVENANCE.PUBLIC : PROVENANCE.SYNTHETIC,
            addressLine1: PROVENANCE.SYNTHETIC,
          },
        },
      });

      const contactCount = isStress ? 6 : isSparse ? 0 : 1 + (L % 2);
      for (let c = 0; c < contactCount; c += 1) {
        const n = contacts.length;
        contacts.push({
          collection: "contacts", id: locationId + "-con-" + pad(c, 2),
          data: {
            accountId, locationId,
            name: isStress ? "Alexandra Featherstone-Whitmore " + (c + 1) : FIRST[n % 6] + " " + LAST[n % 6],
            title: isStress ? "Regional Director of Food and Beverage Operations and Equipment Services" : TITLES[n % 4],
            email: (isStress ? "alexandra.featherstone.whitmore.regional.director" : "contact" + n) + "@" + slug(b.name) + ".invalid",
            dataProvenance: PROVENANCE.SYNTHETIC,
          },
        });
      }
    }

    // INSTALLED EQUIPMENT, emitted once this account's locations exist -- a unit is placed AT a
    // location, and a fixture that invented a locationId would create the dangling reference the
    // world's own invariant check exists to catch.
    equipment.push(...equipmentForAccount({
      accountIndex: i,
      accountId,
      accountName: name,
      locationIds: locations.filter((l) => l.data.accountId === accountId).map((l) => l.id),
      stressName: isStress,
    }));
  });

  // ── The fleet, as MOBILE Inventory Locations the Truck Registry can actually read.
  //
  // THE CONTRACT IS mobileLocationFromFirestore, NOT THIS OBJECT LITERAL. The previous shape wrote
  // `locationType: "MOBILE"` -- a field the repository does not read -- and omitted `locationId`,
  // `type`, and the whole version/audit block. Every truck therefore failed closed as a malformed
  // stored record, which meant every MOBILE transfer endpoint would have resolved DESTINATION_INVALID.
  //
  // Nothing noticed for three passes because nothing had ever resolved a truck THROUGH the registry:
  // the ledger takes a location reference at its word, and truck balances were only ever summed, not
  // validated. Transfers are the first domain that asks whether the truck exists.
  //
  // Fourth record type in this program to be internally consistent and unreadable by its own
  // authority -- after Parts, the governed warehouse, and the opening balances.
  CERT_TRUCKS.forEach((t) => {
    trucks.push({
      collection: "mobile_locations", id: t.id,
      data: {
        locationId: t.id,              // must EQUAL the document id
        type: "MOBILE",                // the field the repository reads
        displayLabel: t.displayLabel,
        homeWarehouseId: t.homeWarehouseId,
        active: t.active,              // must be a real boolean
        version: 1,
        createdBy: FLEET_RECORD_AUTHOR,
        updatedBy: FLEET_RECORD_AUTHOR,
        dataProvenance: PROVENANCE.SYNTHETIC,
      },
    });
  });

  // ============================ THE WORKFORCE JOINS THE WORLD ============================
  //
  // Added 2026-08-21. The 47 synthetic employees existed in data/workforce.mjs and were used by
  // every capacity and authority report, but were NOT part of buildWorld -- so `verify` expected a
  // world without them and the sandbox could never contain the people the reports described.
  //
  // That gap is exactly the failure this module's own header warns about: the analysis was correct
  // about a population that did not exist anywhere but in the analysis.
  //
  // EMPLOYEE RECORDS CONFER NO AUTHORITY. certGovernedRoles is written as fixture DATA describing
  // the INTENDED grant set; it is not a grant and the server does not read it as one. Conferring
  // authority still requires a governed, audited roleAssignments write through the trusted command
  // path, which is a separate protected action and is not performed here or by seeding.
  for (const e of buildWorkforce()) {
    employees.push({
      collection: "employees",
      id: e.employeeId,
      data: {
        employeeId: e.employeeId,
        firstName: e.firstName, lastName: e.lastName, displayName: e.displayName,
        securityRole: e.securityRole, operationalRoles: e.operationalRoles,
        employmentStatus: e.employmentStatus, active: e.active,
        certGovernedRoles: e.certGovernedRoles,
        certAssignments: e.certAssignments,
        certWorkload: e.certWorkload, certAvailable: e.certAvailable,
        certEmployeeNumber: e.certEmployeeNumber,
        certEmail: e.certEmail, certPhone: e.certPhone,
        dataProvenance: e.dataProvenance,
      },
    });
  }

  // ── THE WORK PEOPLE ARE ACTUALLY DOING ──────────────────────────────────────────────────────
  //
  // Eleven technicians declared a workload category and not one job existed anywhere in the world.
  // A label describing a workload nothing produced is the same shape as every defect this program
  // has found, so the assignments are seeded and the certification checks DERIVE each profile from
  // the count rather than reading the label back.
  //
  // STATIC, because no command creates them: completeAssignedJob reads a job and refuses to touch
  // one that is not yours and not in_progress, and nothing anywhere writes one. A technician's
  // schedule is part of the world's starting position, not the output of a service.
  const locationsByAccount = new Map();
  for (const l of locations) {
    const acct = l.data.accountId;
    locationsByAccount.set(acct, [...(locationsByAccount.get(acct) ?? []), l.id]);
  }
  const equipmentByAccount = new Map();
  for (const e of equipment) {
    const acct = e.data.accountId;
    equipmentByAccount.set(acct, [...(equipmentByAccount.get(acct) ?? []), e.id]);
  }
  const accountIds = accounts.map((a) => a.id);
  const employeeRecords = employees.map((e) => e.data ?? e);
  const technicians = buildTechnicianRecords(employeeRecords);
  const jobs = buildJobRecords(employeeRecords, {
    accounts: accountIds, locationsByAccount, equipmentByAccount,
  });

  return { version: CERTIFICATION_WORLD_VERSION, accounts, locations, contacts, equipmentModels,
    equipment, parts, trucks, employees, technicians, jobs, marker };
}

export { TAYLOR_MODELS, ICETRO_MODELS, CERT_TRUCKS, stateForIndex, partsRoomQtyFor, truckAllocationFor, INVENTORY_STATE };
