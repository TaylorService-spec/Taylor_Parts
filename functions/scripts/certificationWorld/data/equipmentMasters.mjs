// EQUIPMENT MASTER — Taylor and Icetro, from the manufacturers' own published catalogs.
//
// PROVENANCE. Model numbers and their configuration descriptors are REAL, taken from
// taylor-company.com's soft serve / frozen yogurt equipment listing and icetroamerica.com's product
// pages (retrieved 2026-08-21). They are public product facts about equipment lines, not claims
// about any customer.
//
// Everything downstream of a model -- which business owns a unit, its serial, install date, warranty
// and service history -- is SYNTHETIC certification data. See manifest.mjs.
//
// BUSINESS LINE. Taylor models carry lineOfBusiness TAYLOR; Icetro carries VENTANA, per the
// established Ventana/Icetro relationship (docs: Ventana ice-machine lifecycle). This is the field
// the reporting separation is measured on, so it is set from the manufacturer rather than guessed
// per record.

export const TAYLOR_MODELS = Object.freeze([
  // Soft serve / frozen yogurt — taylor-company.com/equipment/soft-serve-fro-yo/
  { modelNumber: "C152", family: "SOFT_SERVE", config: "Single flavor, countertop, gravity" },
  { modelNumber: "C161", family: "SOFT_SERVE", config: "Multi flavor, countertop, gravity" },
  { modelNumber: "C606", family: "SHAKE_SOFT_SERVE", config: "Heat treatment combination shake & soft serve, floor standing" },
  { modelNumber: "C612", family: "SOFT_SERVE", config: "Single flavor, floor standing" },
  { modelNumber: "C706", family: "SOFT_SERVE", config: "Single flavor, countertop" },
  { modelNumber: "C707", family: "SOFT_SERVE", config: "Single flavor, countertop, gravity" },
  { modelNumber: "C708", family: "SOFT_SERVE", config: "Single flavor, countertop, heat treatment" },
  { modelNumber: "C709", family: "SOFT_SERVE", config: "Single flavor, countertop, heat treatment" },
  { modelNumber: "C712", family: "SHAKE_SOFT_SERVE", config: "Multi flavor, combo milkshake, floor standing" },
  { modelNumber: "C713", family: "SOFT_SERVE", config: "Multi flavor, floor standing, gravity" },
  { modelNumber: "C716", family: "SOFT_SERVE", config: "Multi flavor, floor standing, heat treatment" },
  { modelNumber: "C717", family: "SOFT_SERVE", config: "Multi flavor, floor standing, heat treatment" },
  { modelNumber: "C722", family: "SOFT_SERVE", config: "Multi flavor, countertop, pump" },
  { modelNumber: "C723", family: "SOFT_SERVE", config: "Multi flavor, countertop, gravity" },
  { modelNumber: "C791", family: "SOFT_SERVE", config: "Multi flavor, floor standing, gravity" },
  { modelNumber: "C794", family: "SOFT_SERVE", config: "Multi flavor, floor standing, gravity" },
  { modelNumber: "772", family: "SOFT_SERVE", config: "Multi flavor, floor standing, gravity" },
  { modelNumber: "8752", family: "SOFT_SERVE", config: "Single flavor, floor standing, pump" },
  { modelNumber: "8756", family: "SOFT_SERVE", config: "Multi flavor, floor standing" },
  { modelNumber: "0632", family: "SHAKE_SOFT_SERVE", config: "Combination soft serve & shake freezer" },
  { modelNumber: "0736", family: "SOFT_SERVE", config: "Single flavor, countertop, heat treatment" },
  { modelNumber: "0738", family: "SOFT_SERVE", config: "Multi flavor, countertop, heat treatment" },
].map((m) => Object.freeze({ ...m, manufacturer: "Taylor", lineOfBusiness: "TAYLOR" })));

export const ICETRO_MODELS = Object.freeze([
  // Soft serve — listed alongside Taylor on the same catalog page (Taylor distributes Icetro soft serve).
  { modelNumber: "ISI-161TH", family: "SOFT_SERVE", config: "Single flavor, countertop, gravity, heat treatment" },
  { modelNumber: "ISI-161TI", family: "SOFT_SERVE", config: "Single flavor, countertop, gravity" },
  { modelNumber: "ISI-163TT", family: "SOFT_SERVE", config: "Single flavor, countertop, gravity" },
  { modelNumber: "ISI-203SN", family: "SOFT_SERVE", config: "Multi flavor, floor standing, gravity" },
  { modelNumber: "ISI-203SNN", family: "SOFT_SERVE", config: "Multi flavor, floor standing, gravity" },
  { modelNumber: "ISI-271SHSN", family: "SOFT_SERVE", config: "Single flavor, semi-automatic, floor standing, gravity" },
  { modelNumber: "ISI-271THSN", family: "SOFT_SERVE", config: "Single flavor, semi-automatic, countertop, gravity" },
  { modelNumber: "ISI-300TA", family: "SOFT_SERVE", config: "Single flavor, countertop, gravity" },
  { modelNumber: "ISI-301TH", family: "SOFT_SERVE", config: "Single flavor, countertop, gravity, heat treatment" },
  { modelNumber: "ISI-303SNA", family: "SOFT_SERVE", config: "Multi flavor, floor standing, gravity" },

  // Ice machines — icetroamerica.com. Naming is IM-{capacity}-{A|W|R}{C|H}: air/water/remote cooled,
  // full Cube or Half cube; a -22 suffix is the 22-inch cabinet. IU- is undercounter.
  { modelNumber: "IU-0070-OU", family: "ICE_UNDERCOUNTER", config: "Undercounter, gourmet cube, 70 lbs" },
  { modelNumber: "IM-0350-AC", family: "ICE_MODULAR", config: "Modular head, full cube, air-cooled, 350 lbs" },
  { modelNumber: "IM-0350-AH", family: "ICE_MODULAR", config: "Modular head, half cube, air-cooled, 350 lbs" },
  { modelNumber: "IM-0460-AC", family: "ICE_MODULAR", config: "Modular head, full cube, air-cooled, 460 lbs" },
  { modelNumber: "IM-0460-AH", family: "ICE_MODULAR", config: "Modular head, half cube, air-cooled, 460 lbs, 30-inch" },
  { modelNumber: "IM-0460-AH-22", family: "ICE_MODULAR", config: "Modular head, half cube, air-cooled, 460 lbs, 22-inch" },
  { modelNumber: "IM-0460-WC", family: "ICE_MODULAR", config: "Modular head, full cube, water-cooled, 460 lbs" },
  { modelNumber: "IM-0460-WH", family: "ICE_MODULAR", config: "Modular head, half cube, water-cooled, 460 lbs" },
  { modelNumber: "IM-0550-AH", family: "ICE_MODULAR", config: "Modular head, half cube, air-cooled, 550 lbs" },
  { modelNumber: "IM-0750-AC", family: "ICE_MODULAR", config: "Modular head, full cube, air-cooled, 750 lbs" },
  { modelNumber: "IM-1100-AH", family: "ICE_MODULAR", config: "Modular head, half cube, air-cooled, 1100 lbs" },
  { modelNumber: "IM-1100-WH", family: "ICE_MODULAR", config: "Modular head, half cube, water-cooled, 1100 lbs" },
  { modelNumber: "IM-1700-AC", family: "ICE_MODULAR", config: "Modular head, full cube, air-cooled, 1700 lbs" },
  { modelNumber: "IM-1700-RC", family: "ICE_MODULAR", config: "Modular head, full cube, remote-cooled, 1700 lbs" },
  { modelNumber: "IM-2000-AH", family: "ICE_MODULAR", config: "Modular head, half cube, air-cooled, 2000 lbs" },
  { modelNumber: "IM-2000-RH", family: "ICE_MODULAR", config: "Modular head, half cube, remote-cooled, 2000 lbs" },
].map((m) => Object.freeze({ ...m, manufacturer: "Icetro", lineOfBusiness: "VENTANA" })));

export const ALL_MODELS = Object.freeze([...TAYLOR_MODELS, ...ICETRO_MODELS]);
