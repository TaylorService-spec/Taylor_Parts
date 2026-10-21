// THE ENTRY-POINT INVENTORY FOR THE WORK ORDER OPERATING-COMPANY BOUNDARY (lane DWO; DECISIONS #DWO-company).
//
// One row per operation of the closed /operations/work-orders table, classified by HOW the Work Order company boundary applies to it. The offline suite
// (workOrderCompanyAuthority.test.mjs) fails when the table gains or loses an operation that is not classified here, and the Postgres suite
// (workOrderCompanyBoundaryPostgres.test.mjs) drives every row of the kinds below from this same list, so a new operation cannot ship uncovered.
//
//   ID               takes a Work Order id; the company predicate is inside its (locking) SELECT; a foreign id is the plain miss. Administrator mode UNRESTRICTED (tenant-wide before).
//   ID_OWN           takes a Work Order id; ALREADY bounded by the caller's own company authority before DWO (D-248-1); the Administrator stays bounded (mode OWN). Unchanged.
//   ID_RELATION      ID, behind a record relation (the assigned Employee): capability, then relation, then company.
//   LIST             a list / board / search over Work Orders, bounded by the company reach.
//   AGGREGATE        a figure over Work Orders, bounded by the company reach.
//   CREATE           creates a Work Order in a stated company (D-248-1; Q-1a for the Sales Order link). Unchanged.
//   EMPLOYEE         keyed by an Employee (the schedule is the Employee's), bounded by the Employee's company (G-9). Reads no Work Order row beyond the Employee's own schedule.
//   POLICY           self-scheduling configuration (a policy per company and type), not a Work Order.
//   NONE             reads no Work Order.
export const WORK_ORDER_ROUTE_ENTRY_POINTS = Object.freeze({
  readWorkOrder: "ID",
  listWorkOrders: "LIST",
  describeWorkOrderListQuery: "LIST",
  listMyAssignedWorkOrders: "LIST",
  listWorkOrderTechnicians: "ID_OWN",
  listWorkOrderOperatingCompanies: "NONE",
  readMyWorkOrderCapabilities: "NONE",
  createWorkOrder: "CREATE",
  markWorkOrderReady: "ID",
  scheduleWorkOrder: "ID_OWN",
  unscheduleWorkOrder: "ID",
  rescheduleWorkOrder: "ID_OWN",
  dispatchWorkOrder: "ID_OWN",
  closeWorkOrder: "ID",
  cancelWorkOrder: "ID",
  setWorkOrderPartsPlan: "ID",
  acceptWorkOrder: "ID_RELATION",
  startWorkOrderTravel: "ID_RELATION",
  arriveAtWorkOrder: "ID_RELATION",
  startWorkOrderWork: "ID_RELATION",
  recordWorkOrderExecution: "ID_RELATION",
  completeWorkOrder: "ID_RELATION",
  listInstallableEquipmentForWorkOrder: "ID_RELATION",
  recordWorkOrderEquipmentInstall: "ID_RELATION",
  readTechnicianAvailability: "EMPLOYEE",
  readEmployeeWorkSchedule: "EMPLOYEE",
  setTechnicianWorkingHours: "EMPLOYEE",
  recordTechnicianUnavailability: "EMPLOYEE",
  endTechnicianUnavailability: "EMPLOYEE",
  findAvailableTechnicianSlots: "EMPLOYEE",
  suggestWorkOrderPlacement: "ID_OWN",
  readWorkOrderLabor: "ID",
  recordWorkOrderLabor: "ID",
  readWorkOrderFieldContext: "ID",
  readWorkOrderReadiness: "ID",
  readTechnicianExecutionStats: "AGGREGATE",
  readWorkOrderConsumptionSnapshot: "AGGREGATE",
  readTechnicianVolumeBreakdown: "AGGREGATE",
  setWorkOrderEstimatedDuration: "ID",
  saveSelfSchedulingPolicy: "POLICY",
  listSelfSchedulingPolicies: "POLICY",
  issueSelfSchedulingLink: "ID",
  revokeSelfSchedulingLink: "ID",
  readSelfSchedulingSessions: "ID",
});

/** Entry points on OTHER routes that take a Work Order id or list Work Orders (not in the /operations/work-orders table). */
export const OTHER_ROUTE_WORK_ORDER_ENTRY_POINTS = Object.freeze({
  "equipment:readWorkOrderEquipment": "ID",
  "inbound:attachInboundWork": "ID",
  "inbound:readInboundWorkRequest": "LIST",
  "commercial:listCoordinatedOperations": "LIST",
  "experience:searchEos (workOrder kind)": "LIST",
  "experience:readMyWork (assigned work, dispatch queue)": "LIST",
  "workforce:listAssignedWorkForEmployee (WORK_ORDER)": "LIST",
});
