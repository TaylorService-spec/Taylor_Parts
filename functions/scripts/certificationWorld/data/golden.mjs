// GOLDEN LIFECYCLE FIXTURES - deterministic accounts whose CURRENT STATE and HISTORY are known
// facts, so a later question has a checkable answer rather than an opinion.
//
// Each carries its expected answers UP FRONT. That ordering matters: writing the expected answer
// after seeing what the system produced is how a question bank ends up certifying whatever the
// system happens to do. These are written from business intent, then measured against.
//
// allowedPersonas / deniedPersonas are expectations about GOVERNED AUTHORITY, not nav visibility --
// the full-site certification already established those are different questions.
//
// Compact table form on purpose: 20 fixtures written as prose objects is 200 lines of near-identical
// punctuation, and a reviewer cannot see at a glance that every row carries the same five facts.
// Columns: key | expectedState | expectedHistory | allowedPersonas | deniedPersonas | Q=A pairs
const T = [
["new-prospect","PROSPECT_NEW","none","admin,dispatcher","technician","Is this a customer yet?=No - prospect, never transacted."],
["qualified-prospect","OPPORTUNITY_OPEN","opportunity created","admin,dispatcher","technician","Is there an open opportunity?=Yes.;Has anything shipped?=No."],
["stalled-opportunity","OPPORTUNITY_STALLED","opportunity created, no movement since","admin,dispatcher","technician","Which opportunities need attention?=This one - past expected close, no activity."],
["closed-won-order","SALES_ORDER_OPEN","opportunity -> WON -> sales order","admin","technician","Did this convert?=Yes - a sales order exists.;Is it fulfilled?=Not yet."],
["closed-lost","OPPORTUNITY_LOST","opportunity -> LOST","admin,dispatcher","technician","Is this in the pipeline?=No - closed lost."],
["multi-location-enterprise","ACTIVE_ENTERPRISE","equipment across multiple locations","admin,dispatcher","","Is equipment split across sites?=Yes."],
["taylor-service-lifecycle","SERVICE_COMPLETE","WO created -> dispatched -> parts used -> completed","admin,dispatcher,technician","","Which line of business?=TAYLOR.;Was a part consumed?=Yes."],
["icetro-service-lifecycle","SERVICE_COMPLETE","WO created -> dispatched -> parts used -> completed","admin,dispatcher,technician","","Which line of business?=VENTANA.;Which manufacturer?=Icetro."],
["multi-line-po","PO_OPEN","PO raised, nothing received","admin","technician","Is stock inbound?=Yes - open PO.;Has any arrived?=No."],
["partial-receiving","PO_PARTIALLY_RECEIVED","PO raised -> partial receipt","admin","technician","Is the PO complete?=No - partially received."],
["put-away","PUT_AWAY_RECORDED","receipt -> put-away","admin,warehouseManager","technician","Did custody change?=No - a bin describes, the warehouse owns (DECISIONS 116)."],
["pick-stage","STAGED","pick/stage recorded","admin,partsAssociate","","Does picking reserve stock?=No - commitment is a work-order lifecycle effect."],
["warehouse-transfer","TRANSFER_COMPLETE","TRANSFER_OUT -> TRANSFER_IN","admin,warehouseManager","partsAssociate","Where is the stock now?=At the destination warehouse."],
["truck-handoff","ON_TRUCK","TRANSFER_OUT warehouse -> TRANSFER_IN mobile location","admin,warehouseManager","partsAssociate","Is truck stock still company inventory?=Yes.;Is it warehouse-available?=No."],
["technician-part-usage","PART_CONSUMED","truck stock -> consumed on WO","admin,technician","","Where did the part come from?=The technician truck, not the parts room."],
["cycle-count","COUNT_SUBMITTED","count opened -> counted -> awaiting reconcile","admin,partsAssociate","warehouseManager","Can the counter approve their own variance?=No (DECISIONS 111).;Did counting move stock?=No."],
["return-intake","AWAITING_DISPOSITION","return intake recorded","admin,warehouseManager","partsAssociate","Did the return restore stock?=No (DECISIONS 118 - intake is not disposition)."],
["dormant-customer","DORMANT","old service history, nothing recent","admin,dispatcher","","Is this account active?=No - dormant.;Did it ever transact?=Yes, historically."],
["mixed-line-account","ACTIVE_MIXED","equipment on both lines","admin,dispatcher","","Does reporting separate the lines?=Yes - Taylor and Ventana are distinct."],
["serialized-equipment","SERIALIZED_INSTALLED","serialized receipt -> install","admin,warehouseManager","","Is serialized stock fungible?=No - each unit keeps its own identity."],
];

const splitList = (s) => (s ? s.split(",") : []);
const splitQa = (s) => Object.fromEntries(s.split(";").map((p) => {
  const i = p.indexOf("=");
  return [p.slice(0, i), p.slice(i + 1)];
}));

export const GOLDEN_ACCOUNTS = Object.freeze(T.map(([key, expectedState, expectedHistory, allowed, denied, qa]) =>
  Object.freeze({
    key, expectedState, expectedHistory,
    allowedPersonas: Object.freeze(splitList(allowed)),
    deniedPersonas: Object.freeze(splitList(denied)),
    answers: Object.freeze(splitQa(qa)),
  })));
