// INSTALLED EQUIPMENT — the serialized units customers actually own.
//
// ============================ WHAT THIS IS, AND IS NOT ============================
//
// equipmentMasters.mjs holds the CATALOG: real Taylor and Icetro model numbers, published product
// facts about equipment lines. This file places synthetic UNITS of those models at synthetic
// customers. Everything here -- ownership, serial, install date, warranty, condition -- is
// certification data and makes no claim about any real business.
//
// ============================ WHY THE DISTRIBUTION IS UNEVEN ON PURPOSE ============================
//
// 250 identical assets with different serial numbers would test nothing. Every screen would render
// the same row, every report the same shape, and a defect that only appears at density or at zero
// would be invisible. So the population is deliberately lumpy:
//
//   * customers with NO equipment at all -- the empty state is a real state, and a fixture set where
//     everyone owns something cannot prove the empty case renders honestly
//   * customers with exactly one unit
//   * customers with 2-5, the ordinary middle
//   * a few with 6-10
//   * two deliberate high-density sites, to expose table and card behaviour under load
//
// and crosswise: Taylor-only, Icetro-only, and mixed-fleet customers, because the Taylor/Ventana
// reporting separation is measured on lineOfBusiness and needs all three shapes to be measurable.
//
// AGE AND WARRANTY ARE DERIVED, NOT RANDOM. Install dates spread across six years from the pinned
// EPOCH, and warranty is install + 24 months -- so "out of warranty" is a CONSEQUENCE of the install
// date rather than an independently invented flag that could contradict it. A fixture whose warranty
// and install date disagree is worse than one with neither.
//
// DETERMINISTIC. Everything is a function of an index. No clock, no randomness -- buildWorld() twice
// returns byte-identical records, which is what makes "seed twice, expect zero creates" meaningful.
import { TAYLOR_MODELS, ICETRO_MODELS, modelIdOf } from "./equipmentMasters.mjs";

/** Pinned so install dates never drift; mirrors build.mjs's EPOCH. */
const EPOCH = Date.parse("2026-01-05T09:00:00.000Z");
const DAY = 86400000;
const MONTH = DAY * 30;

const pad = (n, w = 4) => String(n).padStart(w, "0");

/**
 * How many units each account owns, and of whose equipment.
 *
 * Keyed by account INDEX so the shape is stable across rebuilds. Accounts not named here own
 * nothing, which is deliberate -- see the header.
 */
export const FLEET_PROFILE = Object.freeze({
  // Two deliberate high-density sites. These are the visual-stress cases for Equipment lists,
  // customer detail panels and any per-customer rollup.
  3: { count: 18, mix: "MIXED" },
  41: { count: 14, mix: "MIXED" },
  // A representative spread of ordinary fleets.
  0: { count: 7, mix: "TAYLOR" },
  7: { count: 9, mix: "ICETRO" },
  12: { count: 6, mix: "MIXED" },
  19: { count: 8, mix: "TAYLOR" },
  26: { count: 6, mix: "ICETRO" },
  33: { count: 10, mix: "MIXED" },
});

/** Ordinary fleets for the remaining accounts, by index modulus. Leaves real gaps. */
function ordinaryFleet(i) {
  if (i % 11 === 4) return null;              // owns nothing -- the empty state
  if (i % 11 === 8) return null;              // owns nothing
  if (i % 7 === 0) return { count: 1, mix: i % 2 ? "ICETRO" : "TAYLOR" };
  if (i % 5 === 0) return { count: 2 + (i % 3), mix: "MIXED" };
  if (i % 3 === 0) return { count: 2 + (i % 4), mix: "TAYLOR" };
  if (i % 3 === 1) return { count: 2 + (i % 3), mix: "ICETRO" };
  return { count: 1 + (i % 2), mix: i % 4 === 2 ? "MIXED" : "TAYLOR" };
}


// ============================ OPERATING COMPANY — AN AUTHORED FIXTURE FACT ============================
//
// Owner ruling R-2 (2026-08-30). Every synthetic equipment asset carries an explicit
// `operatingCompanyId`, copied from its FLEET's declaration below.
//
// IT IS NOT DERIVED FROM ANYTHING. Not the model, the manufacturer, `lineOfBusiness`, the customer,
// the title holder, the serial prefix, or a location name -- every one of those is a prohibited
// proxy, and `lineOfBusiness` in particular is the trap, because it sits right there on the record
// and looks like an answer. It is a PRODUCT LINE, not a COMPANY: a Taylor-line machine can
// perfectly well belong to Ventana's books.
//
// THE 2:1 RULE WAS AN AUTHORING MECHANISM, NOT A RUNTIME RULE. This map was generated ONCE by
// walking the fleets in stable account-index order and assigning taylor/taylor/ventana repeating,
// then PERSISTED here as literal values. Nothing computes it any more, and nothing may -- a runtime
// that derived a company from a fleet's ordinal position would silently reassign every asset the
// moment an account was inserted in the middle. Persisting the result is what retires the ordinal.
//
// Result: 85 fleets / 278 units -- 57 fleets and 190 units Taylor, 28 fleets and 88 units Ventana.
// A fleet is assigned WHOLE: one customer's machines belong to one operating company.
export const FLEET_OPERATING_COMPANY = Object.freeze({
  0: "taylor", 1: "taylor", 2: "ventana", 3: "taylor", 5: "taylor",
  6: "ventana", 7: "taylor", 9: "taylor", 10: "ventana", 11: "taylor",
  12: "taylor", 13: "ventana", 14: "taylor", 16: "taylor", 17: "ventana",
  18: "taylor", 19: "taylor", 20: "ventana", 21: "taylor", 22: "taylor",
  23: "ventana", 24: "taylor", 25: "taylor", 26: "ventana", 27: "taylor",
  28: "taylor", 29: "ventana", 31: "taylor", 32: "taylor", 33: "ventana",
  34: "taylor", 35: "taylor", 36: "ventana", 38: "taylor", 39: "taylor",
  40: "ventana", 41: "taylor", 42: "taylor", 43: "ventana", 44: "taylor",
  45: "taylor", 46: "ventana", 47: "taylor", 49: "taylor", 50: "ventana",
  51: "taylor", 53: "taylor", 54: "ventana", 55: "taylor", 56: "taylor",
  57: "ventana", 58: "taylor", 60: "taylor", 61: "ventana", 62: "taylor",
  64: "taylor", 65: "ventana", 66: "taylor", 67: "taylor", 68: "ventana",
  69: "taylor", 71: "taylor", 72: "ventana", 73: "taylor", 75: "taylor",
  76: "ventana", 77: "taylor", 78: "taylor", 79: "ventana", 80: "taylor",
  82: "taylor", 83: "ventana", 84: "taylor", 86: "taylor", 87: "ventana",
  88: "taylor", 89: "taylor", 90: "ventana", 91: "taylor", 93: "taylor",
  94: "ventana", 95: "taylor", 97: "taylor", 98: "ventana", 99: "taylor",
});

/**
 * The operating company that owns this account's fleet, or null.
 *
 * A LOOKUP, not a calculation. An account with a fleet but no entry returns null and its assets are
 * built with no company rather than a guessed one -- an unowned synthetic asset is a visible gap,
 * a wrongly-owned one is not.
 */
export function fleetOperatingCompany(accountIndex) {
  return FLEET_OPERATING_COMPANY[accountIndex] ?? null;
}

export function fleetFor(accountIndex) {
  return FLEET_PROFILE[accountIndex] ?? ordinaryFleet(accountIndex);
}

/** Model chosen deterministically from the mix. */
function modelFor(mix, accountIndex, unitIndex) {
  const seed = accountIndex * 31 + unitIndex * 7;
  if (mix === "TAYLOR") return TAYLOR_MODELS[seed % TAYLOR_MODELS.length];
  if (mix === "ICETRO") return ICETRO_MODELS[seed % ICETRO_MODELS.length];
  // MIXED alternates, so a mixed fleet genuinely contains both lines rather than leaning one way.
  return unitIndex % 2 === 0
    ? TAYLOR_MODELS[seed % TAYLOR_MODELS.length]
    : ICETRO_MODELS[seed % ICETRO_MODELS.length];
}

/**
 * A synthetic serial that could not be mistaken for a manufacturer's.
 *
 * The CW- prefix is the point: these must be unique and stable, and must never be readable as a real
 * serial history. Manufacturer serial formats are deliberately not imitated.
 */
export function serialFor(accountIndex, unitIndex, modelNumber) {
  const slug = String(modelNumber).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
  return `CW-${slug}-${pad(accountIndex, 3)}${pad(unitIndex, 2)}`;
}

/**
 * Age in months, spread across six years.
 *
 * Coprime-ish moduli so age does NOT correlate with fleet size or line of business -- otherwise
 * every old unit would belong to the same few customers and "old equipment" could not be tested
 * independently of "large fleet".
 */
function ageMonthsFor(accountIndex, unitIndex) {
  return ((accountIndex * 13 + unitIndex * 17) % 72) + 1;
}

const WARRANTY_MONTHS = 24;

/**
 * Build every installed unit for one account.
 *
 * `locationIds` are the account's own locations; units are distributed across them round-robin so
 * multi-location customers have equipment in more than one place -- the case a per-location rollup
 * needs and a single-location fixture cannot exercise.
 */
export function equipmentForAccount({ accountIndex, accountId, accountName, locationIds, stressName = false }) {
  const fleet = fleetFor(accountIndex);
  if (!fleet || !locationIds.length) return [];
  // Read once for the whole fleet, so every unit of one customer's fleet carries the same company.
  const operatingCompanyId = fleetOperatingCompany(accountIndex);

  const out = [];
  for (let u = 0; u < fleet.count; u += 1) {
    const model = modelFor(fleet.mix, accountIndex, u);
    const ageMonths = ageMonthsFor(accountIndex, u);
    const installedMs = EPOCH - ageMonths * MONTH;
    const warrantyMs = installedMs + WARRANTY_MONTHS * MONTH;
    const serialNumber = serialFor(accountIndex, u, model.modelNumber);

    // RETIRED units exist so the lifecycle has an end state and lists have something to exclude.
    // Tied to age: a retired unit is an old one, never a new one, because the alternative is a
    // record that contradicts itself.
    const retired = ageMonths > 60 && (accountIndex + u) % 9 === 0;
    const inactive = !retired && ageMonths > 48 && (accountIndex + u) % 13 === 0;

    out.push({
      collection: "equipment",
      id: `cw-eq-${pad(accountIndex, 3)}-${pad(u, 2)}`,
      data: {
        accountId,
        locationId: locationIds[u % locationIds.length],
        // A name a human can read on a list, not a model number alone.
        name: stressName
          ? `${model.manufacturer} ${model.modelNumber} ${model.config} -- extended descriptor retained for visual-stress certification of equipment naming, wrapping and truncation behaviour`
          : `${model.manufacturer} ${model.modelNumber}`,
        manufacturer: model.manufacturer,
        model: model.modelNumber,
        // The REGISTRY id, through the one derivation (equipmentMasters.canonicalEquipmentModelId).
        // This used to mint its own `cw-model-...` string inline -- a second answer to "what is this
        // model called", agreeing with build.mjs only because both were wrong in the same way.
        equipmentModelId: modelIdOf(model),
        serialNumber,
        assetTag: `AT-${pad(accountIndex, 3)}${pad(u, 2)}`,
        status: retired ? "RETIRED" : inactive ? "INACTIVE" : "ACTIVE",
        installedDate: new Date(installedMs).toISOString().slice(0, 10),
        warrantyExpiresDate: new Date(warrantyMs).toISOString().slice(0, 10),
        // The PRODUCT LINE, kept because the Taylor/Ventana reporting separation is measured on it.
        // Deliberately NOT the same fact as operatingCompanyId below.
        lineOfBusiness: model.lineOfBusiness,
        // The authored ownership fact (ruling R-2). Omitted rather than guessed when a fleet has no
        // declaration, so a gap reads as a gap.
        ...(operatingCompanyId === null ? {} : { operatingCompanyId }),
        certAgeMonths: ageMonths,
        certAccountName: accountName,
        dataProvenance: "SYNTHETIC_CERTIFICATION_FACT",
      },
    });
  }
  return out;
}
