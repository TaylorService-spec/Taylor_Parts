from ed import edit
edit("src/eosOps/eosOpsHttp.ts", [
('''import { createPartSupplierItem, listPartSupplierItems, setPartSupplierItemStatus, setPreferredPartSupplierItem, updatePartSupplierItem } from "./partSupplierTerms.js";''',
'''import { createPartSupplierItem, listPartSupplierItems, setPartSupplierItemStatus, setPreferredPartSupplierItem, updatePartSupplierItem } from "./partSupplierTerms.js";
import { listReturnIntakeOptions, recordReturnIntake } from "./returnIntake.js";'''),
('''  "listTruckRoster",
  "readTruckStock",
] as const);''',
'''  "listTruckRoster",
  "readTruckStock",
  // RETURNS INTAKE (Firebase exit F7a, DECISIONS #242): the caller's companies and the receiving warehouses each allows.
  "listReturnIntakeOptions",
] as const);'''),
('''  "setPreferredPartSupplierItem",
] as const);''',
'''  "setPreferredPartSupplierItem",
  // RETURNS INTAKE (Firebase exit F7a, DECISIONS #242): inventory.returns.intake + the #237 company check. Intake only --
  // NO ledger movement (#118). Not behind the Reorder activation boundary: it is its own authority.
  "recordReturnIntake",
] as const);'''),
('''  setPreferredPartSupplierItem: "/operations/inventory",
});''',
'''  setPreferredPartSupplierItem: "/operations/inventory",
  listReturnIntakeOptions: "/operations/inventory",
  recordReturnIntake: "/operations/inventory",
});'''),
('''      case "correctReorderReceipt": {''',
'''      // Conditioned grants withheld (the supplier-terms actor): a capability reached only through an unevaluated grant
      // condition does not take a return in.
      case "listReturnIntakeOptions": {
        const { actor, pool } = await supplierTermsActor();
        return ok(await listReturnIntakeOptions({ pool }, actor, request.input ?? {}));
      }
      case "recordReturnIntake": {
        const { actor, pool } = await supplierTermsActor();
        return ok(await recordReturnIntake({ pool }, actor, request.input ?? {}));
      }
      case "correctReorderReceipt": {'''),
])
