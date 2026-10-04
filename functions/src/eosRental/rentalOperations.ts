// THE RENTAL OPERATIONS TABLE (DECISIONS #207) -- served on /operations/rental by the Operations transport, resolved exactly
// like the Work Order, Equipment and Finance routes (verified token -> Principal -> tenant -> capabilities).
//
// AUTHORITY, separated as the Controller requires (nothing here grants anything; each command checks its own key):
//   view        rental.agreement.read      fleet, agreements, the workspace
//   agreement   rental.agreement.manage    create / activate / amend / extend / close / cancel
//   assign      rental.unit.assign         reserve (incl. exchange) / release
//   deploy      workOrder.create + equipment.install   the delivery / install Work Order (the normal Work Order path)
//   return      rental.unit.return         initiate / receive (+ WAREHOUSE scope) / inspect
//   finance     rental.charge.record       charge eligibility -> RENTAL billing package; settlement stays /operations/finance
//   config      rental.fleet.manage        designate into the fleet / UNAVAILABLE / release a service hold
// Administering EOS confers none of these.
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import {
  activateRentalAgreement, amendRentalAgreementTerms, createRentalAgreement, designateFleetUnit, determineRentalChargeTax, endRentalAgreement, initiateRentalReturn,
  inspectRentalUnit, listFleetUnits, listRentalAgreements, readFleetUnit, readRentalAgreement, readRentalWorkspace, receiveRentalReturn, recordRentalCharge,
  releaseRentalReservation, reserveRentalUnit, setFleetUnitAvailability,
} from "./rental";

export const RENTAL_ROUTE = "/operations/rental";

type Op = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;
const run = (fn: (pool: WorkOrderOperationDeps["pool"], actor: WorkOrderCaller["actor"], input: Record<string, unknown>) => Promise<unknown>): Op =>
  (deps, caller, input) => fn(deps.pool, caller.actor, input);

export const EOS_RENTAL_OPERATIONS: Readonly<Record<string, Op>> = Object.freeze({
  // reads
  readRentalWorkspace: run(readRentalWorkspace),
  listRentalAgreements: run(listRentalAgreements),
  readRentalAgreement: run(readRentalAgreement),
  listFleetUnits: run(listFleetUnits),
  readFleetUnit: run(readFleetUnit),
  // fleet (configuration)
  designateFleetUnit: run(designateFleetUnit),
  setFleetUnitAvailability: run(setFleetUnitAvailability),
  // agreement
  createRentalAgreement: (deps, caller, input) => createRentalAgreement(deps.pool, caller.actor, input, deps.now),
  activateRentalAgreement: run(activateRentalAgreement),
  amendRentalAgreementTerms: run(amendRentalAgreementTerms),
  endRentalAgreement: run(endRentalAgreement),
  // assign
  reserveRentalUnit: run(reserveRentalUnit),
  releaseRentalReservation: run(releaseRentalReservation),
  // return / inspection
  initiateRentalReturn: run(initiateRentalReturn),
  receiveRentalReturn: run(receiveRentalReturn),
  inspectRentalUnit: run(inspectRentalUnit),
  // finance
  recordRentalCharge: run(recordRentalCharge),
  determineRentalChargeTax: run(determineRentalChargeTax),
});
export const RENTAL_READ_OPERATIONS = Object.freeze(["readRentalWorkspace", "listRentalAgreements", "readRentalAgreement", "listFleetUnits", "readFleetUnit"]);
export const RENTAL_OPERATIONS = Object.freeze(Object.keys(EOS_RENTAL_OPERATIONS));
export const isRentalOperation = (name: unknown): name is string => typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_RENTAL_OPERATIONS, name);
