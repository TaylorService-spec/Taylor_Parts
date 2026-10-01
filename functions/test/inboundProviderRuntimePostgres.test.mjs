// REAL MAILBOX INGESTION -> EOS / POSTGRESQL (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment A --
// "ACCEPTANCE -- MAIL INGESTION").
//
//     provider -> EOS provider runtime -> PostgreSQL Inbound Work -> governed review -> Accept -> EOS Work Order
//
// Proven through the REAL transport (POST /operations/inbound-work) against a real, fully migrated PostgreSQL, with a
// FAKE provider adapter standing in for Microsoft Graph (the network is the only thing faked; the runtime, the OAuth
// state rules, the credential vault contract, the normalizer, the intake and the custody are the shipped code):
//
//   custody     no token column exists; the credential is a reference; consent is not CONNECTED; OAuth state is
//               single-use, actor-bound and stored by hash; disconnect destroys the credential
//   ingestion   provider message -> PostgreSQL Inbound Work; retry -> NO duplicate; same thread -> associated; an
//               attachment -> custodied bytes (sha256 verified); malformed / unsafe -> QUARANTINED; a transport failure ->
//               classified, cursor held, retried
//   review      an authorized reviewer processes it (Accept -> EOS Work Order, the custodied attachment readable
//               through the request); an unauthorized persona is refused
//   Firebase    the runtime graph reaches no Firebase module; no Firestore staging exists anywhere in the path
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { handleOperationsRequest } = require("../lib/eosOps/eosOpsHttp.js");
const { INBOUND_WORK_ROUTE, EOS_INBOUND_WORK_OPERATIONS } = require("../lib/eosOps/inboundWorkOperations.js");
const runtime = require("../lib/eosOps/inboundProviderRuntime.js");
const { createInMemoryVault } = require("../lib/inboundWork/providerCredentialVault.js");
const { ProviderTransportError } = require("../lib/inboundWork/providerTransport.js");
const { MICROSOFT_INBOUND_SCOPES } = require("../lib/inboundWork/microsoftGraphTransport.js");
const { GOOGLE_INBOUND_SCOPES } = require("../lib/inboundWork/gmailTransport.js");
const { unsafeAttachmentReason } = require("../lib/inboundWork/attachmentCustodyRules.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-provider";
const FIXTURE_ACTOR = "fixture";

// ════════════════════ static ════════════════════

test("static: the EOS provider runtime, recovery and self-scheduling reach no Firebase module, transitively", () => {
  const seen = new Set();
  const offenders = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/require\("([^"]+)"\)/g)) {
      const spec = m[1];
      if (/firebase/.test(spec)) offenders.push(`${file.replace(FUNCTIONS_DIR, "")} -> ${spec}`);
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec.endsWith(".js") ? spec : `${spec}.js`);
        if (existsSync(target)) visit(target);
      }
    }
  };
  for (const f of ["inboundProviderRuntime.js", "inboundWorkRecovery.js", "inboundWorkOperations.js", "selfScheduling.js", "selfSchedulingHttp.js"]) {
    visit(resolve(FUNCTIONS_DIR, "lib/eosOps", f));
  }
  assert.deepEqual(offenders, [], "no firebase / firebase-admin / firebase-functions anywhere in the graph");
  // The retired Firebase provider runtime is gone from the codebase -- nothing can import it.
  for (const f of ["emailDeliverySchedule", "emailDeliveryService", "emailTransportCallables", "emailConnectionCommands", "attachmentCustody",
    "inboundWorkCallables", "inboundIntakeCommand", "inboundDecisionCommands", "inboundWorkReadService", "emailAdminCommands", "inboundCandidateResolution"]) {
    assert.equal(existsSync(resolve(FUNCTIONS_DIR, "src/inboundWork", `${f}.ts`)), false, `${f}.ts is retired`);
  }
  const index = readFileSync(resolve(FUNCTIONS_DIR, "src/index.ts"), "utf8");
  assert.doesNotMatch(index, /from "\.\/inboundWork\//, "no Firebase inbound export remains");
});

test("static: least authority -- the provider scopes are exactly the accepted ones", () => {
  assert.deepEqual(MICROSOFT_INBOUND_SCOPES, ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/Mail.Read.Shared"]);
  assert.deepEqual(GOOGLE_INBOUND_SCOPES, ["https://www.googleapis.com/auth/gmail.readonly"]);
  for (const forbidden of ["Mail.Send", "Mail.ReadWrite", "Mail.ReadBasic.All", "gmail.send", "gmail.modify"]) {
    assert.equal([...MICROSOFT_INBOUND_SCOPES, ...GOOGLE_INBOUND_SCOPES].some((s) => s.includes(forbidden)), false, forbidden);
  }
  for (const op of ["saveInboundConnection", "startInboundConnectionAuthorization", "completeInboundConnectionAuthorization", "testInboundConnection",
    "disconnectInboundConnection", "pollInboundMailboxNow", "retryInboundDelivery", "readInboundAttachment", "readInboundProviderReadiness",
    "releaseInboundWork", "reassignInboundWork", "listInboundRecoveryTargets"]) {
    assert.equal(typeof EOS_INBOUND_WORK_OPERATIONS[op], "function", op);
  }
});

test("static: the unsafe-attachment screen", () => {
  assert.match(unsafeAttachmentReason({ filename: "invoice.pdf.exe", mimeType: "application/pdf", size: 10 }), /\.exe/);
  assert.match(unsafeAttachmentReason({ filename: "run.PS1", mimeType: "text/plain", size: 10 }), /\.ps1/);
  assert.match(unsafeAttachmentReason({ filename: "x.bin", mimeType: "application/x-msdownload", size: 10 }), /content type/);
  assert.match(unsafeAttachmentReason({ filename: "big.pdf", mimeType: "application/pdf", size: 30 * 1024 * 1024 }), /limit/);
  assert.equal(unsafeAttachmentReason({ filename: "warranty-authorization.pdf", mimeType: "application/pdf", size: 2048 }), null);
});

// ════════════════════ the fake provider ════════════════════

/** A Graph-shaped mailbox. Only the network is fake; every call is recorded. */
function fakeGraph() {
  const state = { messages: new Map(), bytes: new Map(), order: [], calls: [], failList: null, validateOk: true, refreshed: 0, exchanged: 0 };
  const adapter = {
    provider: "MICROSOFT_365",
    buildAuthorizationUrl({ tenantOrWorkspace, redirectUri, state: s, codeChallenge }) {
      const u = new URL(`https://login.example/${tenantOrWorkspace}/oauth2/v2.0/authorize`);
      u.searchParams.set("scope", MICROSOFT_INBOUND_SCOPES.join(" "));
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("state", s);
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
      return u.toString();
    },
    async exchangeAuthorizationCode({ code, codeVerifier }) {
      state.calls.push(["exchange", code, Boolean(codeVerifier)]);
      if (code !== "good-code") throw new ProviderTransportError("AUTH_REVOKED", "bad code");
      state.exchanged += 1;
      return { accessToken: "AT-first", refreshToken: "RT-secret-value-1", expiresAt: Date.now() + 3600_000, scope: MICROSOFT_INBOUND_SCOPES.join(" ") };
    },
    async refreshAccessToken({ refreshToken }) {
      state.refreshed += 1;
      if (!refreshToken.startsWith("RT-")) throw new ProviderTransportError("AUTH_REVOKED", "revoked");
      return { accessToken: `AT-${state.refreshed}`, refreshToken, expiresAt: Date.now() + 3600_000, scope: "" };
    },
    async validateMailboxAccess({ mailboxAddress }) {
      state.calls.push(["validate", mailboxAddress]);
      return state.validateOk ? { ok: true, detail: `${mailboxAddress} is readable.` } : { ok: false, detail: `${mailboxAddress} returned 403.` };
    },
    async listNewMessageIds({ cursor, limit }) {
      state.calls.push(["list", cursor?.value ?? null]);
      if (state.failList) { const e = state.failList; throw e; }
      const from = cursor?.value ? Number(cursor.value) : 0;
      const ids = state.order.slice(from, from + limit);
      return { messageIds: ids, cursor: { value: String(from + ids.length) }, truncated: from + ids.length < state.order.length };
    },
    async fetchMessage({ messageId }) {
      state.calls.push(["fetch", messageId]);
      return state.messages.get(messageId);
    },
    async fetchAttachment({ messageId, attachmentId }) {
      state.calls.push(["attachment", messageId, attachmentId]);
      const b = state.bytes.get(`${messageId}|${attachmentId}`);
      if (!b) throw new ProviderTransportError("ATTACHMENT_FETCH_FAILED", "gone");
      return { bytes: b, mimeType: "application/pdf", filename: "x" };
    },
  };
  const deliver = (id, raw, attachments = {}) => {
    state.messages.set(id, raw);
    state.order.push(id);
    for (const [aid, bytes] of Object.entries(attachments)) state.bytes.set(`${id}|${aid}`, bytes);
  };
  return { adapter, state, deliver };
}

const graph = ({ id, conv, subject, body, from = "dispatch@corporate.example", attachments = [], headers = [] }) => ({
  id, conversationId: conv, internetMessageId: `<${id}@corporate.example>`, receivedDateTime: "2026-09-30T15:00:00Z", subject,
  from: { emailAddress: { address: from } }, toRecipients: [{ emailAddress: { address: "service@taylor.example" } }],
  body: { contentType: "HTML", content: body }, internetMessageHeaders: headers, attachments,
});

// ════════════════════ the journey ════════════════════

test("real mailbox ingestion on PostgreSQL through /operations/inbound-work", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `iprov_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    runtime.setInboundProviderRuntimeForTest(null);
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const repo = new PostgresPolicyRepository(pool);
  const fixtureActor = { tenantId: T, uid: FIXTURE_ACTOR };
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,'taylor','taylor','ACTIVE','NATIVE','fixture','fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-p',$1,'Summit Grill','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ('loc-p',$1,'acct-p','Summit Kitchen','f','f')`, [T]);

  let roleN = 0;
  const persona = async (subject, capabilities) => {
    const principalId = await repo.transact(fixtureActor, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "eos" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    roleN += 1;
    const role = await repo.transact(fixtureActor, (tx) =>
      tx.createRole({ key: `prov${roleN}`, name: `Prov ${roleN}`, description: null, origin: "CUSTOM", protected: false }));
    for (const key of new Set(capabilities)) {
      const { rowCount } = await q(
        `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
         SELECT $1, $2, $3, c.id, $4, $4, $4 FROM eos_policy.capabilities c WHERE c.key = $5`, [`rc_${role.id}_${key}`, T, role.id, FIXTURE_ACTOR, key]);
      assert.equal(rowCount, 1, key);
    }
    await repo.transact(fixtureActor, async (tx) => {
      const av = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: FIXTURE_ACTOR, grantedAt: new Date().toISOString(), accessVersionAtGrant: av });
    });
    return { subject, principalId };
  };
  const ADMIN = await persona("intake-admin", ["inboundWork.intake.manage"]);
  const ADMIN_B = await persona("intake-admin-b", ["inboundWork.intake.manage"]);
  const REVIEWER = await persona("reviewer", ["inboundWork.request.read", "inboundWork.request.accept", "inboundWork.request.decline",
    "inboundWork.request.attach", "workOrder.create"]);
  const NOBODY = await persona("nobody", []);
  const call = async (who, operation, input = {}) => {
    const res = await handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE",
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "eos" }) },
    { method: "POST", url: INBOUND_WORK_ROUTE, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);

  const fake = fakeGraph();
  const vault = createInMemoryVault();
  let rnd = 0;
  runtime.setInboundProviderRuntimeForTest({
    environment: "nonprod", transportFor: () => fake.adapter, providerConfigured: () => true, vault,
    randomBytes: (n) => createHash("sha256").update(`r${rnd++}`).digest().subarray(0, n),
  });

  // ── custody is structural ──
  await t.test("CUSTODY: no token column exists; a credential value is refused; consent without a credential cannot be CONNECTED", async () => {
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'eos_ops' AND table_name = 'inbound_provider_connections'`)).rows.map((r) => r.column_name);
    assert.deepEqual(cols.filter((c) => /token|secret_value|password/.test(c) && c !== "last_token_refresh_at"), []);
    await assert.rejects(q(`INSERT INTO eos_ops.inbound_provider_connections (tenant_id,id,connection_name,provider,credential_secret_name,updated_by_principal_id)
                            VALUES ($1,'c-x','X','MICROSOFT_365','eyJhbGciOiJSUzI1NiJ9.token.value','f')`, [T]), /credential_is_a_reference/);
    await assert.rejects(q(`INSERT INTO eos_ops.inbound_provider_connections (tenant_id,id,connection_name,provider,oauth_status,updated_by_principal_id)
                            VALUES ($1,'c-y','Y','MICROSOFT_365','CONNECTED','f')`, [T]), /connected_has_credential/);
  });

  let connectionId, mailboxId;
  await t.test("CONNECT: save identity (no credential accepted) -> authorize (PKCE, hashed single-use state) -> CONNECTED only after a mailbox read", async () => {
    refused(await call(ADMIN, "saveInboundConnection", { connectionName: "Taylor M365", provider: "MICROSOFT_365", refreshToken: "x" }), 400, "INPUT_FIELD_NOT_ACCEPTED");
    refused(await call(REVIEWER, "saveInboundConnection", { connectionName: "Taylor M365", provider: "MICROSOFT_365" }), 403, "CAPABILITY_MISSING");
    const conn = ok(await call(ADMIN, "saveInboundConnection", { connectionName: "Taylor M365", provider: "MICROSOFT_365",
      tenantOrWorkspace: "taylor-tenant", connectedAccount: "intake@taylor.example" }));
    connectionId = conn.id;
    assert.deepEqual([conn.oauthStatus, conn.connectionStatus, conn.credentialHeld], ["NOT_CONNECTED", "NOT_CONNECTED", false]);
    const mb = ok(await call(ADMIN, "saveInboundMailbox", { displayName: "Service", emailAddress: "service@taylor.example", purpose: "SERVICE",
      destination: "SERVICE", connectionId, attachmentPolicy: "STORE" }));
    mailboxId = mb.id;
    assert.match(mailboxId, /^mbx_/);
    const ready = ok(await call(ADMIN, "readInboundProviderReadiness"));
    assert.deepEqual([ready.runtime, ready.transportAvailable, ready.credentialVaultConfigured], ["EOS_POSTGRESQL", true, true]);

    const redirectUri = "https://app.taylor.example/administration/email";
    const started = ok(await call(ADMIN, "startInboundConnectionAuthorization", { connectionId, redirectUri }));
    const url = new URL(started.authorizationUrl);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), MICROSOFT_INBOUND_SCOPES.join(" "));
    const stored = await one(`SELECT state_key FROM eos_ops.inbound_oauth_states WHERE connection_id = $1`, [connectionId]);
    assert.notEqual(stored.state_key, started.state, "the state is stored by its hash, never as presented");
    assert.equal(stored.state_key, createHash("sha256").update(started.state).digest("hex"));

    refused(await call(ADMIN_B, "completeInboundConnectionAuthorization", { connectionId, state: started.state, code: "good-code", redirectUri }),
      403, "STATE_ACTOR_MISMATCH", "another administrator cannot finish it");
    const done = ok(await call(ADMIN, "completeInboundConnectionAuthorization", { connectionId, state: started.state, code: "good-code", redirectUri }));
    assert.deepEqual([done.oauthStatus, done.connectionStatus, done.health, done.mailboxesValidated], ["CONNECTED", "CONNECTED", "HEALTHY", 1]);
    refused(await call(ADMIN, "completeInboundConnectionAuthorization", { connectionId, state: started.state, code: "good-code", redirectUri }),
      403, "STATE_ALREADY_USED", "a replayed callback");
    assert.equal(vault.store.get(connectionId), "RT-secret-value-1", "the refresh token is in the vault");
    const row = await one(`SELECT * FROM eos_ops.inbound_provider_connections WHERE id = $1`, [connectionId]);
    assert.equal(row.credential_secret_name, `memory://${connectionId}`);
    const everything = JSON.stringify((await q(`SELECT * FROM eos_ops.inbound_provider_connections`)).rows)
      + JSON.stringify((await q(`SELECT * FROM eos_ops.inbound_oauth_states`)).rows) + JSON.stringify((await q(`SELECT * FROM eos_policy.audit_events`)).rows);
    assert.equal(everything.includes("RT-secret-value-1") || everything.includes("AT-first"), false, "no token anywhere in PostgreSQL");
  });

  await t.test("CONSENT IS NOT CONNECTED: an authorized connection whose mailbox cannot be read is FAILED, not CONNECTED", async () => {
    const c2 = ok(await call(ADMIN, "saveInboundConnection", { connectionName: "Shared M365", provider: "MICROSOFT_365", tenantOrWorkspace: "t2" }));
    ok(await call(ADMIN, "saveInboundMailbox", { displayName: "Warranty", emailAddress: "warranty@taylor.example", purpose: "WARRANTY", connectionId: c2.id }));
    fake.state.validateOk = false;
    const s = ok(await call(ADMIN, "startInboundConnectionAuthorization", { connectionId: c2.id, redirectUri: "https://app.taylor.example/x" }));
    const done = ok(await call(ADMIN, "completeInboundConnectionAuthorization", { connectionId: c2.id, state: s.state, code: "good-code", redirectUri: "https://app.taylor.example/x" }));
    fake.state.validateOk = true;
    assert.deepEqual([done.oauthStatus, done.connectionStatus, done.health], ["CONNECTED", "FAILED", "FAILED"]);
    const d = ok(await call(ADMIN, "disconnectInboundConnection", { connectionId: c2.id }));
    assert.deepEqual([d.oauthStatus, d.credentialHeld], ["REVOKED", false]);
    assert.equal(vault.store.has(c2.id), false, "disconnect DESTROYS the credential");
  });

  const pdf = Buffer.from("%PDF-1.4 warranty authorization WR-4471", "utf8");
  let firstRequestId;
  await t.test("INGEST: provider message -> PostgreSQL Inbound Work; attachment custodied; same thread associated; malformed + unsafe QUARANTINED", async () => {
    fake.deliver("m-1", graph({ id: "m-1", conv: "conv-1", subject: "Warranty service required", body:
      "<p>Authorization: WR-4471<br/>Serial: SN-77</p><p>Problem: walk-in not cooling</p>",
      attachments: [{ id: "att-1", name: "warranty-authorization.pdf", contentType: "application/pdf", size: pdf.length }] }), { "att-1": pdf });
    fake.deliver("m-2", graph({ id: "m-2", conv: "conv-1", subject: "RE: Warranty service required", body: "<p>Still down.</p>",
      headers: [{ name: "In-Reply-To", value: "<m-1@corporate.example>" }, { name: "References", value: "<m-1@corporate.example>" }] }));
    fake.deliver("m-3", "<<corrupted provider payload>>");
    fake.deliver("m-4", graph({ id: "m-4", conv: "conv-4", subject: "Please run the attached", body: "<p>see attached</p>",
      attachments: [{ id: "att-x", name: "invoice.pdf.exe", contentType: "application/octet-stream", size: 1000 }] }), { "att-x": Buffer.from("MZ") });

    refused(await call(REVIEWER, "pollInboundMailboxNow", { mailboxId }), 403, "CAPABILITY_MISSING", "a reviewer cannot drive the poller");
    const r = ok(await call(ADMIN, "pollInboundMailboxNow", { mailboxId }));
    assert.deepEqual([r.fetched, r.created, r.threadMatched, r.quarantined, r.attachmentsStored, r.failures, r.transportFailure],
      [4, 1, 1, 2, 1, 0, null]);
    assert.equal(fake.state.calls.some((c) => c[0] === "attachment" && c[2] === "att-x"), false, "the unsafe attachment's bytes were never fetched");

    const rows = (await q(`SELECT id, status, source_message_id, attachment_custody, status_note, ingested_by_principal_id FROM eos_ops.inbound_work_requests ORDER BY source_message_id`)).rows;
    assert.deepEqual(rows.map((x) => [x.source_message_id, x.status, x.attachment_custody]), [
      ["m-1", "NEEDS_REVIEW", "COMPLETE"], ["m-3", "QUARANTINED", "NONE"], ["m-4", "QUARANTINED", "REFUSED_UNSAFE"]]);
    assert.ok(rows.every((x) => x.ingested_by_principal_id === runtime.INBOUND_DELIVERY_SYSTEM_ACTOR), "ingested by the system delivery actor");
    assert.match(rows[1].status_note, /Malformed/);
    assert.match(rows[2].status_note, /Unsafe attachment/);
    firstRequestId = rows[0].id;
    const held = await one(`SELECT content, content_sha256, size_bytes, filename FROM eos_ops.inbound_work_attachments WHERE request_id = $1`, [firstRequestId]);
    assert.equal(Buffer.compare(held.content, pdf), 0);
    assert.equal(held.content_sha256, createHash("sha256").update(pdf).digest("hex"));
    const thread = (await q(`SELECT provider_message_id, message_role FROM eos_ops.inbound_work_messages WHERE request_id = $1 ORDER BY recorded_at`, [firstRequestId])).rows;
    assert.deepEqual(thread.map((m) => [m.provider_message_id, m.message_role]), [["m-1", "ORIGINAL"], ["m-2", "REPLY"]]);
    const mbx = await one(`SELECT delivery_cursor, last_polled_at FROM eos_ops.inbound_mailboxes WHERE id = $1`, [mailboxId]);
    assert.deepEqual(mbx.delivery_cursor, { value: "4" });
  });

  await t.test("RETRY: the provider re-announces everything -- NO duplicate intake, message, or attachment", async () => {
    const before = await one(`SELECT (SELECT count(*)::int FROM eos_ops.inbound_work_requests) r, (SELECT count(*)::int FROM eos_ops.inbound_work_messages) m,
                                      (SELECT count(*)::int FROM eos_ops.inbound_work_attachments) a`);
    await q(`UPDATE eos_ops.inbound_mailboxes SET delivery_cursor = NULL WHERE id = $1`, [mailboxId]);
    const r = ok(await call(ADMIN, "pollInboundMailboxNow", { mailboxId }));
    assert.deepEqual([r.fetched, r.created, r.duplicates, r.attachmentsStored], [4, 0, 4, 0]);
    const after = await one(`SELECT (SELECT count(*)::int FROM eos_ops.inbound_work_requests) r, (SELECT count(*)::int FROM eos_ops.inbound_work_messages) m,
                                     (SELECT count(*)::int FROM eos_ops.inbound_work_attachments) a`);
    assert.deepEqual(after, before);
  });

  await t.test("TRANSPORT FAILURE: classified, the cursor holds, the failure surfaces, and a retry resolves it", async () => {
    fake.deliver("m-5", graph({ id: "m-5", conv: "conv-5", subject: "Ice machine leaking", body: "<p>Problem: leaking</p>" }));
    const cursor = (await one(`SELECT delivery_cursor FROM eos_ops.inbound_mailboxes WHERE id = $1`, [mailboxId])).delivery_cursor;
    fake.state.failList = new ProviderTransportError("PROVIDER_UNAVAILABLE", "503 upstream", 30);
    const r = ok(await call(ADMIN, "pollInboundMailboxNow", { mailboxId }));
    assert.equal(r.transportFailure, "PROVIDER_UNAVAILABLE");
    assert.deepEqual((await one(`SELECT delivery_cursor FROM eos_ops.inbound_mailboxes WHERE id = $1`, [mailboxId])).delivery_cursor, cursor);
    const config = ok(await call(ADMIN, "readInboundIntakeConfiguration"));
    const failure = config.exceptions.find((f) => f.subjectId === "list");
    assert.deepEqual([failure.code, failure.disposition, failure.attempts, failure.status], ["PROVIDER_UNAVAILABLE", "RETRYABLE", 1, "OPEN"]);
    assert.equal(JSON.stringify(config).includes("RT-secret"), false);
    fake.state.failList = null;
    const retried = ok(await call(ADMIN, "retryInboundDelivery", { failureId: failure.id }));
    assert.equal(retried.result.created, 1);
    assert.equal(retried.failure.status, "RESOLVED");
  });

  await t.test("REVIEW: an authorized reviewer processes the intake -> Accept creates the EOS Work Order; the attachment reads through the request; unauthorized refused", async () => {
    refused(await call(NOBODY, "listInboundWork"), 403, "CAPABILITY_MISSING");
    refused(await call(ADMIN, "listInboundWork"), 403, "CAPABILITY_MISSING", "intake administration is not review authority");
    const queue = ok(await call(REVIEWER, "listInboundWork", { statuses: ["NEEDS_REVIEW", "QUARANTINED"] }));
    const item = queue.rows.find((x) => x.id === firstRequestId);
    assert.deepEqual([item.sourceMailboxName, item.threadMessageCount, item.attachmentCustody], ["Service", 1, "COMPLETE"]);
    assert.equal(queue.rows.filter((x) => x.status === "QUARANTINED").length, 2);
    const detail = ok(await call(REVIEWER, "readInboundWorkRequest", { requestId: firstRequestId }));
    assert.deepEqual([detail.authorizationNumber, detail.serialNumber], ["WR-4471", "SN-77"]);
    const att = detail.attachmentRefs[0];
    assert.equal(att.custody, "STORED");
    const bytes = ok(await call(REVIEWER, "readInboundAttachment", { requestId: firstRequestId, attachmentId: att.attachmentId }));
    assert.equal(Buffer.compare(Buffer.from(bytes.contentBase64, "base64"), pdf), 0);
    assert.equal(bytes.servedAs, "application/octet-stream");
    refused(await call(NOBODY, "readInboundAttachment", { requestId: firstRequestId, attachmentId: att.attachmentId }), 403, "CAPABILITY_MISSING");
    const accepted = ok(await call(REVIEWER, "acceptInboundWork", { requestId: firstRequestId, operatingCompanyId: "taylor", customerId: "acct-p", locationId: "loc-p" }));
    assert.match(accepted.workOrderNumber, /^WO-/);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.work_orders`)).n, 1);
  });

  await t.test("DISCONNECT: the credential is destroyed; polling stops; the intake it produced is untouched", async () => {
    const intake = (await one(`SELECT count(*)::int n FROM eos_ops.inbound_work_requests`)).n;
    ok(await call(ADMIN, "disconnectInboundConnection", { connectionId }));
    assert.equal(vault.store.has(connectionId), false);
    const r = ok(await call(ADMIN, "pollInboundMailboxNow", { mailboxId }));
    assert.equal(r.skipped, "CONNECTION_NOT_CONNECTED");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.inbound_work_requests`)).n, intake);
  });

  await t.test("THE CYCLE: one cluster-wide cycle at a time; a concurrent cycle is a no-op", async () => {
    const holder = await pool.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock(hashtextextended('eos-inbound-delivery-cycle', 0))`);
      const r = await runtime.runInboundDeliveryCycle(pool, runtime.currentInboundProviderRuntime());
      assert.equal(r.ran, false);
    } finally {
      await holder.query(`SELECT pg_advisory_unlock(hashtextextended('eos-inbound-delivery-cycle', 0))`);
      holder.release();
    }
    const r = await runtime.runInboundDeliveryCycle(pool, runtime.currentInboundProviderRuntime());
    assert.equal(r.ran, true);
  });
});
