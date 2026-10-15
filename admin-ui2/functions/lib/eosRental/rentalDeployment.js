"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rentalInstallContextOn = rentalInstallContextOn;
exports.recordRentalDeploymentOn = recordRentalDeploymentOn;
const node_crypto_1 = require("node:crypto");
/** Decide, inside the install transaction (rows locked), whether this install is a rental deployment and whether it may proceed. */
async function rentalInstallContextOn(c, tenantId, wo, partId, serialNumber) {
    const { rows: fu } = await c.query(`SELECT * FROM eos_rental.fleet_units WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3 FOR UPDATE`, [tenantId, partId, serialNumber]);
    const unit = fu[0] ?? null;
    if (wo.rentalAgreementId === null) {
        return unit === null ? { kind: "NOT_RENTAL" }
            : { kind: "REFUSED", code: "RENTAL_FLEET_UNIT_NOT_INSTALLABLE", message: "that unit is Taylor rental fleet; it deploys only on its Rental Agreement's INSTALL Work Order, never by sale" };
    }
    const { rows: ag } = await c.query(`SELECT * FROM eos_rental.rental_agreements WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [tenantId, wo.rentalAgreementId]);
    const agreement = ag[0];
    if (!agreement || agreement.status !== "ACTIVE") {
        return { kind: "REFUSED", code: "RENTAL_AGREEMENT_NOT_ACTIVE", message: "the Work Order's Rental Agreement is not active" };
    }
    if (unit === null || unit.availability !== "RESERVED" || unit.current_assignment_id === null) {
        return { kind: "REFUSED", code: "RENTAL_UNIT_NOT_RESERVED", message: "only a fleet unit RESERVED for this Rental Agreement is deployed on its Work Order" };
    }
    const { rows: asg } = await c.query(`SELECT * FROM eos_rental.rental_assignments WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, unit.current_assignment_id]);
    const assignment = asg[0];
    if (!assignment || assignment.agreement_id !== agreement.id || assignment.status !== "RESERVED") {
        return { kind: "REFUSED", code: "RENTAL_UNIT_NOT_RESERVED", message: "the unit is reserved for another Rental Agreement" };
    }
    if (unit.owner_operating_company_key !== wo.operatingCompanyKey || agreement.operating_company_key !== wo.operatingCompanyKey) {
        return { kind: "REFUSED", code: "RENTAL_COMPANY_MISMATCH", message: "the owner company, the agreement and the Work Order must be the same operating company" };
    }
    if (agreement.account_id !== wo.customerId || agreement.customer_location_id !== wo.locationId) {
        return { kind: "REFUSED", code: "RENTAL_SITE_MISMATCH", message: "the Work Order's customer / site is not the Rental Agreement's" };
    }
    return { kind: "RENTAL", unit, assignment, agreement };
}
/** After the install wrote custody + Equipment: the assignment is DEPLOYED and the unit ON_RENT (owner unchanged). */
async function recordRentalDeploymentOn(c, actor, ctx, deployment) {
    await c.query(`UPDATE eos_rental.rental_assignments SET status = 'DEPLOYED', deployment_work_order_id = $3, equipment_id = $4, deployed_at = now()
    WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, ctx.assignment.id, deployment.workOrderId, deployment.equipmentId]);
    await c.query(`UPDATE eos_rental.fleet_units SET availability = 'ON_RENT', version = version + 1, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, ctx.unit.id]);
    await c.query(`INSERT INTO eos_rental.fleet_unit_events (id, tenant_id, fleet_unit_id, event_type, from_availability, to_availability, agreement_id, assignment_id,
        work_order_id, equipment_id, owner_operating_company_key, location_type, location_id, reason, actor_principal_id)
     VALUES ($1,$2,$3,'DEPLOYED','RESERVED','ON_RENT',$4,$5,$6,$7,$8,'EQUIPMENT',$7,$9,$10)`, [`rfe_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, ctx.unit.id, ctx.agreement.id, ctx.assignment.id, deployment.workOrderId, deployment.equipmentId,
        ctx.unit.owner_operating_company_key, ctx.assignment.replaces_assignment_id ? `exchange for ${ctx.assignment.replaces_assignment_id}` : "deployed at the customer site", actor.principalId]);
}
//# sourceMappingURL=rentalDeployment.js.map