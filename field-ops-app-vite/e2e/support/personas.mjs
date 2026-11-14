// The four Parts-family personas the browser network test signs in as, and how it gets their credentials.
//
// TEST INFRASTRUCTURE. Used by both the Playwright spec (any target) and the local seeding script.
//
// CREDENTIALS COME FROM A FILE, NEVER FROM THE REPOSITORY. EOS_NET_CREDENTIALS_FILE names a JSON file in the shape
// scripts/enrollPersonaLogins.js writes (`eos.persona-login-credentials/1`: entries[] of { personaKey, loginIdentifier,
// password, totpSecretBase32 }). `personaKey` is the Employee id. Nothing in this module prints or returns a credential
// except to the sign-in step that types it.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * `nonprodRoles` and `scopes` mirror the persona rows of docs/uat/data/personas.csv (globalRoles / operationalScopes);
 * they are what the LOCAL seed assigns so the capabilities come from the real Role -> capability grants.
 * Against a remote target they are unused.
 */
export const PERSONAS = Object.freeze([
  {
    key: "warehouseAssociate", label: "Warehouse Associate", employeeId: "synthetic-np-emp-warehouse-associate",
    nonprodRoles: ["inventoryCycleCountCounter", "inventoryLookupReader", "inventoryPutAwayOperator", "inventoryStockRelocationOperator", "inventoryTransferOperator", "warehouseAssociate"],
    scopes: ["WAREHOUSE:SC-WH-MAIN", "WAREHOUSE:taylor-main"],
  },
  {
    key: "partsAssociate", label: "Parts Associate", employeeId: "synthetic-np-emp-parts-associate",
    nonprodRoles: ["inventoryLookupReader", "inventoryReceivingClerk", "partsAssociate"],
    scopes: ["REORDER_QUEUE:taylor", "WAREHOUSE:taylor-main"],
  },
  {
    key: "partsManager", label: "Parts Manager", employeeId: "synthetic-np-emp-parts-manager",
    nonprodRoles: ["inventoryLookupReader", "partsManager", "purchasingManager"],
    scopes: ["REORDER_QUEUE:taylor"],
  },
  {
    key: "warehouseManager", label: "Warehouse Manager", employeeId: "synthetic-np-emp-warehouse-manager",
    nonprodRoles: ["inventoryBinAdministrator", "inventoryCycleCountReconciler", "inventoryLookupReader", "inventoryTransferReceiver", "operationalConfigurationAdministrator", "warehouseManager"],
    scopes: ["WAREHOUSE:SC-WH-MAIN", "WAREHOUSE:SC-WH-SERVICE", "WAREHOUSE:taylor-main", "WAREHOUSE:taylor-service"],
  },
]);

/** The credentials entry for a persona: matched by Employee id, else by persona key. Throws a message that names no value. */
export function loadCredentials(file, persona) {
  if (!file) throw new Error("EOS_NET_CREDENTIALS_FILE is not set: the test signs in with governed credentials from a file outside the repository");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const entry = (parsed.entries ?? []).find((e) => e.personaKey === persona.employeeId || e.personaKey === persona.key);
  if (!entry) throw new Error(`no credentials entry for ${persona.key} (${persona.employeeId}) in the credentials file`);
  for (const field of ["loginIdentifier", "password", "totpSecretBase32"]) {
    if (typeof entry[field] !== "string" || entry[field].length === 0) throw new Error(`the credentials entry for ${persona.key} has no ${field}`);
  }
  return { loginIdentifier: entry.loginIdentifier, password: entry.password, totpSecretBase32: entry.totpSecretBase32 };
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(text) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of text.replace(/=+$/g, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 6238, SHA-1, 6 digits, 30 s -- the parameters functions/src/eosAuth/credentialCrypto.ts pins. */
export function totpNow(secretBase32, nowMs = Date.now(), stepOffset = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / 30) + stepOffset));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const o = mac[mac.length - 1] & 0xf;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}
