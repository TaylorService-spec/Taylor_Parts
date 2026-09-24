// THE LEGACY CATALOG MASTER COMMAND LIST -- one place naming every legacy Firestore catalog master
// writer, where its body lives, and the exact guard statement that must open it.
//
// It is shared so that the two proofs cannot drift apart:
//   * functions/test/catalogMaster.test.mjs        -- the MECHANICAL first-statement proof (the guard is
//     the first thing each command body does, before any Firestore handle, id parse, capability
//     resolution, transaction or audit event), plus the closed-set check against the registry;
//   * functions/test/catalogFreezeParity.test.mjs  -- the BEHAVIOURAL proof (every family refuses under
//     FROZEN/RETIRED with the governed code, is untouched while OPEN, and its callable maps the refusal
//     to failed-precondition rather than internal).
//
// `writerIds` is checked to be EXACTLY the key set of FIRESTORE_CATALOG_WRITERS, in both directions: a
// registered writer with no entry here fails, and an entry naming an unregistered writer fails. So a new
// legacy catalog writer cannot be added without a guard, and a guard cannot be deleted without a red test.
//
// Two forms, because two commands are reached through a shared body with an action discriminator rather
// than through one exported function per writer:
//   FUNCTION_BODY  the guard is the literal first statement of `fn`'s body.
//   ACTION_GATE    the guard is an `if (action === "...")` line inside the command's accept step, which
//                  must still precede capability resolution (asserted separately).

export const LEGACY_CATALOG_MASTER_COMMANDS = Object.freeze([
  // ── Part (the copy scope) ───────────────────────────────────────────────────────────────────────
  Object.freeze({
    family: "part", form: "FUNCTION_BODY", module: "src/partMaster/partMasterCommands.ts", fn: "createPart",
    writerIds: Object.freeze(["part.create"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("part.create");',
  }),
  Object.freeze({
    family: "part", form: "FUNCTION_BODY", module: "src/partMaster/partMasterCommands.ts", fn: "updatePart",
    writerIds: Object.freeze(["part.update"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("part.update");',
  }),
  Object.freeze({
    family: "part", form: "FUNCTION_BODY", module: "src/partMaster/partMasterCommands.ts", fn: "changePartStatus",
    writerIds: Object.freeze(["part.changeStatus"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("part.changeStatus");',
  }),

  // ── Manufacturer (same module, same catalog capabilities, `manufacturers`) ──────────────────────
  Object.freeze({
    family: "manufacturer", form: "FUNCTION_BODY", module: "src/partMaster/partMasterCommands.ts", fn: "createManufacturer",
    writerIds: Object.freeze(["manufacturer.create"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("manufacturer.create");',
  }),
  Object.freeze({
    family: "manufacturer", form: "FUNCTION_BODY", module: "src/partMaster/partMasterCommands.ts", fn: "updateManufacturer",
    writerIds: Object.freeze(["manufacturer.update"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("manufacturer.update");',
  }),
  Object.freeze({
    family: "manufacturer", form: "FUNCTION_BODY", module: "src/partMaster/partMasterCommands.ts", fn: "changeManufacturerStatus",
    writerIds: Object.freeze(["manufacturer.changeStatus"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("manufacturer.changeStatus");',
  }),

  // ── Supplier ("a catalog-governed object", supplierMasterCommands.ts header; `suppliers`) ───────
  Object.freeze({
    family: "supplier", form: "FUNCTION_BODY", module: "src/supplierMaster/supplierMasterCommands.ts", fn: "createSupplier",
    writerIds: Object.freeze(["supplier.create"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("supplier.create");',
  }),
  Object.freeze({
    family: "supplier", form: "FUNCTION_BODY", module: "src/supplierMaster/supplierMasterCommands.ts", fn: "updateSupplier",
    writerIds: Object.freeze(["supplier.update"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("supplier.update");',
  }),
  Object.freeze({
    family: "supplier", form: "FUNCTION_BODY", module: "src/supplierMaster/supplierMasterCommands.ts", fn: "changeSupplierStatus",
    writerIds: Object.freeze(["supplier.activate", "supplier.deactivate"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen(action === "activateSupplier" ? "supplier.activate" : "supplier.deactivate");',
  }),

  // ── Part Alias (`part_aliases`; cutover plan §2 gap 3 dependent authority) ──────────────────────
  Object.freeze({
    family: "partAlias", form: "FUNCTION_BODY", module: "src/partMaster/partAliasCommands.ts", fn: "createPartAlias",
    writerIds: Object.freeze(["partAlias.create"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("partAlias.create");',
  }),
  Object.freeze({
    family: "partAlias", form: "FUNCTION_BODY", module: "src/partMaster/partAliasCommands.ts", fn: "changeAliasStatus",
    writerIds: Object.freeze(["partAlias.deactivate", "partAlias.reactivate"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen(action === "deactivatePartAlias" ? "partAlias.deactivate" : "partAlias.reactivate");',
  }),

  // ── Part-Supplier Item (`part_supplier_items`; cutover plan §2 gap 3 dependent authority) ───────
  Object.freeze({
    family: "partSupplierItem", form: "FUNCTION_BODY", module: "src/partMaster/partSupplierItems.ts", fn: "createPartSupplierItem",
    writerIds: Object.freeze(["partSupplierItem.create"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("partSupplierItem.create");',
  }),
  Object.freeze({
    family: "partSupplierItem", form: "FUNCTION_BODY", module: "src/partMaster/partSupplierItems.ts", fn: "updatePartSupplierItem",
    writerIds: Object.freeze(["partSupplierItem.update"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("partSupplierItem.update");',
  }),
  Object.freeze({
    family: "partSupplierItem", form: "FUNCTION_BODY", module: "src/partMaster/partSupplierItems.ts", fn: "changePartSupplierItemStatus",
    writerIds: Object.freeze(["partSupplierItem.changeStatus"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("partSupplierItem.changeStatus");',
  }),
  Object.freeze({
    family: "partSupplierItem", form: "FUNCTION_BODY", module: "src/partMaster/partSupplierItems.ts", fn: "setPreferredSupplier",
    writerIds: Object.freeze(["partSupplierItem.setPreferred"]),
    firstStatement: 'assertFirestoreCatalogWriterOpen("partSupplierItem.setPreferred");',
  }),

  // ── Equipment Model + its alias (one command, one action gate per writer) ───────────────────────
  Object.freeze({
    family: "equipmentModel", form: "ACTION_GATE", module: "src/equipmentCompatibility/commands.ts", fn: "acceptForExecution",
    writerIds: Object.freeze(["equipmentModel.import"]),
    gateLine: 'if (action === "importEquipmentModel") assertFirestoreCatalogWriterOpen("equipmentModel.import");',
  }),
  Object.freeze({
    family: "equipmentModelAlias", form: "ACTION_GATE", module: "src/equipmentCompatibility/commands.ts", fn: "acceptForExecution",
    writerIds: Object.freeze(["equipmentModelAlias.import"]),
    gateLine: 'if (action === "importEquipmentModelAlias") assertFirestoreCatalogWriterOpen("equipmentModelAlias.import");',
  }),
]);

/** The exported `mapError` of every deployed callable module that fronts a command in the list above. */
export const LEGACY_CATALOG_CALLABLE_ERROR_MAPPERS = Object.freeze([
  Object.freeze({ family: "part", lib: "../lib/partMaster/partMasterCallables.js", writerId: "part.create" }),
  Object.freeze({ family: "manufacturer", lib: "../lib/partMaster/manufacturerCallables.js", writerId: "manufacturer.create" }),
  Object.freeze({ family: "supplier", lib: "../lib/supplierMaster/supplierMasterCallables.js", writerId: "supplier.create" }),
  Object.freeze({ family: "partAlias", lib: "../lib/partMaster/partAliasCallables.js", writerId: "partAlias.create" }),
  Object.freeze({ family: "partSupplierItem", lib: "../lib/partMaster/partSupplierItemCallables.js", writerId: "partSupplierItem.create" }),
]);

/**
 * The first statement of `fn`'s body in `source`, trimmed. Deliberately not a single regex: several
 * signatures carry an object type in their return position (`Promise<MutationOutcome & { itemId: ... }>`)
 * and span several lines, and a regex loose enough for those stops being a proof of "first".
 */
export function firstBodyLine(source, fn) {
  const sig = new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${fn}\\(`).exec(source);
  if (sig === null) return null;
  const open = source.indexOf("{\n", sig.index);
  if (open === -1) return null;
  return source.slice(open + 2, source.indexOf("\n", open + 2)).trim();
}
