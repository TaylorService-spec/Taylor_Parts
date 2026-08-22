// CERTIFICATION PARTS CATALOG — the service parts the installed base actually consumes.
//
// ============================ WHY THE WORLD NEEDS ITS OWN PARTS ============================
//
// The sandbox held SEVEN parts. The six inventory conditions (HEALTHY / WATCH / REORDER / CRITICAL /
// ON_ORDER / FALSE_COMFORT) were designed in data/inventory.mjs against a catalog that was never
// built, so `stateForIndex` indexed over nothing and no condition was ever instantiated.
//
// Seven parts also cannot support 278 installed units: every Work Order would demand the same part,
// every shortage would be the same shortage, and a parts screen would render seven rows forever.
//
// ============================ THE PARTS ARE PLAUSIBLE, NOT REAL ============================
//
// These are ordinary refrigeration / soft-serve service components -- the categories a Taylor or
// Icetro unit genuinely consumes. Part NUMBERS are synthetic and CW-prefixed; nothing here claims to
// be a manufacturer's actual part number, price or supersession.
//
// ============================ HOW BALANCES COME TO EXIST ============================
//
// This file declares the catalog and the INTENDED condition of each part. It declares no balance.
//
// Balances are created by movements through the authoritative ledger, because on this schema the
// ledger IS the balance: `fulfillmentAvailability` counts movements at eligible WAREHOUSE locations,
// and truck stock has "NO MOBILE-indexed stock document separate from the ledger" -- it is
// PROVABLY CO-EXTENSIVE with the ledger events (truckRegistry/operationalReferenceProbe.ts).
//
// That is what makes FALSE_COMFORT expressible rather than staged: warehouse availability
// deliberately excludes MOBILE stock ("real inventory, but not sellable warehouse stock"), so a part
// whose quantity sits on trucks is company-owned and warehouse-unfulfillable AS A CONSEQUENCE of
// where its movements put it -- not because a fixture labelled it so.

/** Service-part families, chosen so demand can be tied to the equipment line that consumes them. */
const FAMILIES = Object.freeze([
  { key: "REFRIG", category: "Refrigeration", line: "BOTH", names: [
    "Evaporator Fan Motor", "Condenser Fan Blade", "Expansion Valve", "Refrigerant Filter Drier",
    "Compressor Start Relay", "Condenser Coil Cleaner Kit", "Thermostatic Sensor Probe" ] },
  { key: "DRIVE", category: "Drive Train", line: "TAYLOR", names: [
    "Beater Drive Belt", "Gear Reducer Assembly", "Drive Shaft Seal", "Beater Motor Coupling",
    "Scraper Blade Set", "Drive Motor Brush Kit" ] },
  { key: "SEAL", category: "Seals & Gaskets", line: "BOTH", names: [
    "Draw Valve O-Ring Kit", "Door Gasket", "Hopper Seal", "Faceplate Gasket Set",
    "Shaft Seal Kit", "Drip Tray Grommet" ] },
  { key: "ICE", category: "Ice Making", line: "VENTANA", names: [
    "Water Inlet Valve", "Ice Thickness Probe", "Harvest Solenoid", "Water Pump Assembly",
    "Evaporator Plate Kit", "Bin Level Sensor", "Water Distribution Tube" ] },
  { key: "CTRL", category: "Controls & Electrical", line: "BOTH", names: [
    "Control Board", "Membrane Keypad", "Display Module", "Wiring Harness",
    "High Pressure Switch", "Contactor 24V", "Transformer 120/24V" ] },
  { key: "CONSUM", category: "Consumables", line: "BOTH", names: [
    "Sanitizer Tablets", "Food Grade Lubricant", "Cleaning Brush Set", "Filter Cartridge" ] },
]);

const pad = (n, w = 4) => String(n).padStart(w, "0");

/**
 * The catalog, flat and deterministic.
 *
 * Order is fixed by the family table, so a part's index -- and therefore its inventory condition --
 * is stable across rebuilds. A catalog that reordered itself would reshuffle every condition and
 * make a diff between two seeds unreadable.
 */
let _seq = 0;
export const CERT_PARTS = Object.freeze(
  FAMILIES.flatMap((f, fi) =>
    f.names.map((name, ni) => {
      // SEQUENTIAL, not fi*100+ni.
      //
      // The condition spread is `index % 20`, and 100 % 20 === 0 -- so a family-block index made
      // every family restart at the same offset and only m = 0..6 were ever reachable. HEALTHY
      // (m > 8) could not occur at all: the world had 37 parts and not one healthy one, while the
      // spread claimed 55%. The intended and derived conditions AGREED, because both were reading
      // the same broken index, which is precisely why a fixture must be checked against domain
      // facts and not against its own intent.
      const index = _seq++;
      return Object.freeze({
        index,
        partId: `CW-P-${pad(fi, 2)}${pad(ni, 2)}`,
        name,
        category: f.category,
        family: f.key,
        // Which equipment line consumes it, so Work Order demand can be tied to the units a
        // customer actually owns rather than to an arbitrary part.
        lineOfBusiness: f.line,
        // A handful of SERIAL-tracked parts, because serial handling is a genuinely different path
        // (fulfillmentAvailability excludes SERIAL rows from quantity math entirely) and a catalog
        // with none of them leaves that path unexercised.
        // TWO VOCABULARIES, DELIBERATELY BOTH CARRIED.
        //
        // The Part Master classifies with `controlType` (STANDARD / SERIALIZED / LOT), while the
        // operational ledger validates `trackingMode` against a DIFFERENT set (NONE / SERIAL /
        // LOT). They are not the same field and not the same words: a plain quantity part is
        // STANDARD to the catalog and NONE to the ledger.
        //
        // The first version of this fixture wrote "QUANTITY" -- the value the live part documents
        // carry in `partTrackingMode` -- into the ledger envelope, and the real adapter refused
        // ALL 145 movements with tracking_mode_invalid. Every pure test had passed: the plan was
        // self-consistent and spoke the wrong language. Nothing but the real validator was ever
        // going to say so.
        controlType: f.key === "CTRL" && ni % 3 === 0 ? "SERIALIZED" : "STANDARD",
        // What the LEDGER accepts, derived from the catalog classification rather than restated.
        ledgerTrackingMode: f.key === "CTRL" && ni % 3 === 0 ? "SERIAL" : "NONE",
        // What the PART MASTER document carries, matching the live parts already in the sandbox.
        partTrackingMode: f.key === "CTRL" && ni % 3 === 0 ? "SERIAL" : "QUANTITY",
        unitOfMeasure: "EA",
        stockingUnit: "EACH",
        stockingClass: f.key === "CONSUM" ? "STOCKED" : ni % 7 === 6 ? "NON_STOCKED" : "STOCKED",
        status: "ACTIVE",
      });
    }),
  ),
);

/** Sequential position in the catalog -- the index the inventory-condition spread is keyed on. */
export const CERT_PART_ORDER = Object.freeze(CERT_PARTS.map((p) => p.partId));

/**
 * Reorder point per part.
 *
 * Deterministic and varied: a catalog where every part reorders at the same number makes every
 * shortage look identical and hides any defect in threshold comparison.
 */
export function reorderPointFor(part) {
  const base = part.family === "CONSUM" ? 12 : part.family === "CTRL" ? 3 : 6;
  return base + (part.index % 5);
}

/** The world record for a catalog part. */
export function partRecordFor(part) {
  return {
    collection: "parts",
    id: part.partId,
    data: {
      partId: part.partId,
      sku: part.partId,
      internalPartNumber: part.partId,
      name: part.name,
      category: part.category,
      partTrackingMode: part.partTrackingMode,
      unitOfMeasure: part.unitOfMeasure,
      stockingUnit: part.stockingUnit,
      stockingClass: part.stockingClass,
      controlType: part.controlType,
      certLedgerTrackingMode: part.ledgerTrackingMode,
      status: part.status,
      certFamily: part.family,
      certLineOfBusiness: part.lineOfBusiness,
      certReorderPoint: reorderPointFor(part),
      dataProvenance: "SYNTHETIC_CERTIFICATION_FACT",
    },
  };
}
