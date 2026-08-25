// WHICH WORK ORDER TYPES MAY NAME A MACHINE AT CREATION.
//
// A CLIENT MIRROR of functions/src/workOrderEquipment.ts, and only a mirror. The server re-reads the
// Equipment document inside the create transaction and decides; this exists so a person is told "no"
// by a control rather than by a rejected write.
//
// Kept in step deliberately, and asserted by test against the server module: two copies of a rule
// that drift are worse than one copy in the wrong place, because the UI then offers something the
// server refuses and nobody can tell which is right.
//
// INSTALL is the one that differs, and it is not an exception bolted on: the installed unit does not
// exist until the installation completes, when workOrderInstallCommand links it from the serialized
// asset that was physically delivered. Naming a unit at creation would point at something nobody has
// installed.

export const WORK_ORDER_EQUIPMENT_RULE = Object.freeze({
  SERVICE_CALL: "OPTIONAL_EXISTING",
  PM: "OPTIONAL_EXISTING",
  WARRANTY: "OPTIONAL_EXISTING",
  INSPECTION: "OPTIONAL_EXISTING",
  INSTALL: "FORBIDDEN_AT_CREATE",
});

/** True when a Work Order of this type may carry an equipment reference at creation. */
export function equipmentAllowedAtCreate(type) {
  // An untyped Work Order is valid (it may carry a complaint instead) and is not an INSTALL, so it
  // follows the ordinary rule rather than being refused for a type it does not claim.
  if (!type) return true;
  return WORK_ORDER_EQUIPMENT_RULE[type] !== "FORBIDDEN_AT_CREATE";
}
