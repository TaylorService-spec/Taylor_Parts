// TRADE-IN APPROVAL IS RESERVED TO OWNER / GENERAL MANAGER (Owner ruling G7, DECISIONS #226 / PR-4a).
//
// salesAgreement.tradeIn.approve is a RESERVED capability: only the owner and generalManager Roles may hold it.
//   GRANT side      every other Role (built-in or custom) is a forbidden pair -- refused on write, skipped by every default
//                   writer, reported as FORBIDDEN_PRESENT drift; a direct Principal grant is refused outright.
//   EFFECTIVE side  the trade-in decision and its client offer additionally require a qualifying global reserved Role, so a
//                   row that predates the invariant decides nothing. Nothing is revoked automatically (census first).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-ptradein";
const KEY = "salesAgreement.tradeIn.approve";
const {
  forbiddenPair, reservedCapabilityAdmits, resolveCell, verifyTenantAuthority, RESERVED_CAPABILITY_HOLDERS,
} = require("../lib/adminPolicy/roleCapabilityAdministration.js");
const { protectedAdministratorImpliedKeys } = require("../lib/adminPolicy/protectedAdministrator.js");

test("the reservation is an allow-list: owner and generalManager only, every other Role a forbidden pair", () => {
  assert.deepEqual([...RESERVED_CAPABILITY_HOLDERS.get(KEY).roleKeys].sort(), ["generalManager", "owner"]);
  assert.equal(forbiddenPair("owner", KEY), null);
  assert.equal(forbiddenPair("generalManager", KEY), null);
  for (const role of ["admin", "salesManager", "controller", "aCustomRole"]) {
    const pair = forbiddenPair(role, KEY);
    assert.equal(pair?.invariantClass, "OWNER_GOVERNANCE", role);
    assert.match(pair.ruling, /G7/);
    assert.deepEqual(resolveCell({ roleKey: role, capabilityKey: KEY, decision: "ADMIN_GRANTED", isSystemDefault: true }),
      { shouldHold: false, source: "SYSTEM_INVARIANT" }, `${role}: no decision or default overrides the reservation`);
  }
  assert.equal(forbiddenPair("salesManager", "salesAgreement.accept"), null, "an unreserved capability is untouched");
  assert.equal(reservedCapabilityAdmits(KEY, ["generalManager"]), true);
  assert.equal(reservedCapabilityAdmits(KEY, ["admin", "salesManager"]), false);
  assert.equal(reservedCapabilityAdmits("salesAgreement.accept", []), true);
});

test("verification reports -- never revokes -- a reserved capability held outside its Roles", () => {
  const v = verifyTenantAuthority({
    systemDefault: [{ roleKey: "owner", capabilityKey: KEY }, { roleKey: "generalManager", capabilityKey: KEY }],
    live: [{ roleKey: "owner", capabilityKey: KEY }, { roleKey: "generalManager", capabilityKey: KEY }, { roleKey: "salesManager", capabilityKey: KEY }],
    decisions: [],
    principals: [{ principalId: "p-direct", roleKeys: ["salesManager"], directCapabilityKeys: [KEY] },
      { principalId: "p-gm", roleKeys: ["generalManager"], directCapabilityKeys: [KEY] }],
  });
  const kinds = v.drift.map((d) => `${d.kind}:${d.roleKey}`).sort();
  assert.ok(kinds.includes("FORBIDDEN_PRESENT:salesManager"), kinds.join(","));
  assert.ok(kinds.includes("FORBIDDEN_PRINCIPAL_HOLDING:principal:p-direct"), kinds.join(","));
  assert.ok(!kinds.some((k) => k.includes("p-gm")), "a reserved Role holder is not drift");
  assert.ok(!kinds.some((k) => k.endsWith(":owner") || k.endsWith(":generalManager")));
});

test("protected Administrator standing never implies it (#223 exclusion still holds)", () => {
  const implied = protectedAdministratorImpliedKeys([{ key: "admin", protected: true }, { key: "owner", protected: true }], ["admin"],
    [{ key: KEY, objectKey: "salesAgreement", actionKind: "BUSINESS_ACTION" }]);
  assert.equal(implied.has(KEY), false);
});

test("the trade-in decision and its offer both consult the reservation", () => {
  const cmd = readFileSync(new URL("../src/eosCommercial/commands/salesAgreementCommandService.ts", import.meta.url), "utf8");
  const decide = cmd.slice(cmd.indexOf("function decideTradeIn"), cmd.indexOf("export const approveSalesAgreementTradeIn"));
  assert.match(decide, /requireReservedHolder\(db, actor\.tenantId, actor\.principalId, SALES_AGREEMENT_TRADE_IN_APPROVE_CAPABILITY\)/);
  const offer = readFileSync(new URL("../src/eosCommercial/myCommercialCapabilities.ts", import.meta.url), "utf8");
  assert.match(offer, /RESERVED_CAPABILITY_HOLDERS/);
});

test("PostgreSQL: grants refused outside the reservation; the decision and offer require a reserved Role", { skip: SKIP, concurrency: false }, async (t) => {
  const { pool, q, admin, person } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "ptradein" });
  const { requireReservedHolder } = require("../lib/eosCommercial/commands/commercialCommandKernel.js");
  const { readMyCommercialCapabilities } = require("../lib/eosCommercial/myCommercialCapabilities.js");
  const { rows: [cap] } = await q(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [KEY]);
  assert.ok(cap, "the capability is registered");

  await t.test("census: only owner and generalManager hold it by Role grant", async () => {
    const { rows } = await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY 1`, [T, KEY]);
    for (const { key } of rows) assert.ok(["owner", "generalManager"].includes(key), key);
  });

  await t.test("a grant to any other Role is refused as a SYSTEM_INVARIANT; a direct grant is refused outright", async () => {
    for (const roleKey of ["admin", "salesManager"]) {
      const r = await admin("grantObjectActionToRole", { objectKey: cap.object_key, actionKey: cap.action_key, roleKey, reason: "try the reservation" });
      assert.equal(r.ok, false, roleKey);
      assert.match(r.message, /may never hold salesAgreement\.tradeIn\.approve.*G7/, roleKey);
    }
    const sm = await person("uid-ptradein-direct", ["salesManager"]);
    const d = await admin("grantObjectActionToPrincipal", { objectKey: cap.object_key, actionKey: cap.action_key, principalId: sm.principalId, reason: "exception" });
    assert.equal(d.ok, false);
    assert.match(d.message, /never a direct grant/);
    const { rows } = await q(`SELECT 1 FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND pc.principal_id = $2 AND c.key = $3`, [T, sm.principalId, KEY]);
    assert.equal(rows.length, 0, "nothing was written");
  });

  await t.test("effective authorization: a generalManager passes; a pre-existing rogue grant and Administrator standing do not", async () => {
    const gm = await person("uid-ptradein-gm", ["generalManager"]);
    await requireReservedHolder(pool, T, gm.principalId, KEY);
    // A row that predates the invariant (written past the command path, as an old grant would be).
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-ptradein-rogue',$1,r.id,c.id,'rogue','rogue','rogue' FROM eos_policy.roles r, eos_policy.capabilities c
              WHERE r.tenant_id=$1 AND r.key='salesManager' AND c.key=$2 ON CONFLICT DO NOTHING`, [T, KEY]);
    const sm = await person("uid-ptradein-sm", ["salesManager"]);
    await assert.rejects(requireReservedHolder(pool, T, sm.principalId, KEY), (e) => e.code === "RESERVED_CAPABILITY" && e.category === "FORBIDDEN");
    const { rows: [adminP] } = await q(`SELECT id FROM eos_policy.principals WHERE external_subject = 'uid-ptradein-admin'`);
    if (adminP) await assert.rejects(requireReservedHolder(pool, T, adminP.id, KEY), (e) => e.code === "RESERVED_CAPABILITY");
    await requireReservedHolder(pool, T, sm.principalId, "salesAgreement.accept"); // unreserved: passes

    const offer = (p) => readMyCommercialCapabilities({ pool }, { tenantId: T, principalId: p.principalId, capabilities: new Set([KEY, "salesAgreement.read"]) });
    assert.ok((await offer(gm)).capabilities.includes(KEY), "offered to the General Manager");
    const smOffer = await offer(sm);
    assert.ok(!smOffer.capabilities.includes(KEY), "never offered outside the reservation");
    assert.ok(smOffer.capabilities.includes("salesAgreement.read"), "unreserved offers unchanged");
  });
});
