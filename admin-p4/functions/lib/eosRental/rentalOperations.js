"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRentalOperation = exports.RENTAL_OPERATIONS = exports.RENTAL_READ_OPERATIONS = exports.EOS_RENTAL_OPERATIONS = exports.RENTAL_ROUTE = void 0;
const rental_1 = require("./rental");
exports.RENTAL_ROUTE = "/operations/rental";
const run = (fn) => (deps, caller, input) => fn(deps.pool, caller.actor, input);
exports.EOS_RENTAL_OPERATIONS = Object.freeze({
    // reads
    readRentalWorkspace: run(rental_1.readRentalWorkspace),
    listRentalAgreements: run(rental_1.listRentalAgreements),
    readRentalAgreement: run(rental_1.readRentalAgreement),
    listFleetUnits: run(rental_1.listFleetUnits),
    readFleetUnit: run(rental_1.readFleetUnit),
    // fleet (configuration)
    designateFleetUnit: run(rental_1.designateFleetUnit),
    setFleetUnitAvailability: run(rental_1.setFleetUnitAvailability),
    // agreement
    createRentalAgreement: (deps, caller, input) => (0, rental_1.createRentalAgreement)(deps.pool, caller.actor, input, deps.now),
    activateRentalAgreement: run(rental_1.activateRentalAgreement),
    amendRentalAgreementTerms: run(rental_1.amendRentalAgreementTerms),
    endRentalAgreement: run(rental_1.endRentalAgreement),
    // assign
    reserveRentalUnit: run(rental_1.reserveRentalUnit),
    releaseRentalReservation: run(rental_1.releaseRentalReservation),
    // return / inspection
    initiateRentalReturn: run(rental_1.initiateRentalReturn),
    receiveRentalReturn: run(rental_1.receiveRentalReturn),
    inspectRentalUnit: run(rental_1.inspectRentalUnit),
    // finance
    recordRentalCharge: run(rental_1.recordRentalCharge),
    determineRentalChargeTax: run(rental_1.determineRentalChargeTax),
});
exports.RENTAL_READ_OPERATIONS = Object.freeze(["readRentalWorkspace", "listRentalAgreements", "readRentalAgreement", "listFleetUnits", "readFleetUnit"]);
exports.RENTAL_OPERATIONS = Object.freeze(Object.keys(exports.EOS_RENTAL_OPERATIONS));
const isRentalOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(exports.EOS_RENTAL_OPERATIONS, name);
exports.isRentalOperation = isRentalOperation;
//# sourceMappingURL=rentalOperations.js.map