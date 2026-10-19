// DATA IMPORT ON EOS -- SERVICE HISTORY (Firebase exit B4, DECISIONS #B4; F7f-2). It replaces the Firebase callables stageDataImport,
// executeDataImport and listDataImportJobs for the one entity wired on EOS, with the SAME pipeline and the same job document:
//
//   file -> parse (CSV text or .xlsx base64) -> detect / map / validate -> PREVIEW -> a stored STAGED job -> an explicit approval ->
//   one governed write per row, a failure never stopping the rest -> the job's per-row result.
//
// The parse, mapping, contract, preview, job model and row-by-row orchestrator are the SHARED pure modules under dataImport/ (portable, no
// Firestore): nothing about an import's meaning is re-decided here. What this file supplies is the EOS data plane -- where jobs are kept
// (eos_ops.data_import_jobs), how existing identity and the customer reference are looked up, and how ONE record is written
// (eos_ops.imported_service_history, audited).
//
// WHAT IS WIRED. SERVICE_HISTORY only. Every other entity type is refused ENTITY_NOT_WIRED, honestly, before anything is staged: PARTS and
// INVENTORY write the Catalog, EQUIPMENT the register, CUSTOMERS the CRM -- each is its own governed EOS authority with its own commands, and an
// import would have to call those, not write around them. Copying the existing Firebase history stays HELD; this builds only the path.
//
// AUTHORITY. admin.dataImport.execute for all three operations (Firebase gates stage and list on admin.dataImport.stage; its holders are the same,
// admin alone, and the client already asks stage under this name -- access/eosCapabilityAccess.js). Then COMPANY (#235 / #237): a file's records
// belong to ONE operating company, chosen at staging from the caller's own reach; a job is listed, executed and its records read only by a caller
// who reaches that company, and a job of another company reads as one that does not exist.
import type { Pool, PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import {
  parseSourceFile, parseWorkbookFile, detectEntityType, suggestMapping, validateMapping, projectRows, headerSignature, IntakeError, IMPORT_LIMITS,
  type ColumnMapping, type ImportEntityType,
} from "../dataImport/importIntake.js";
import { buildEntityPreview } from "../dataImport/importPreview.js";
import { stageImportJob, assertExecutable, beginExecution, finishExecution, ImportJobError, type ImportJob } from "../dataImport/importJob.js";
import { executeImportJob, type RowWriter } from "../dataImport/importExecution.js";
import { entityContractFor, naturalIdentityKey } from "../dataImport/contracts/entityContract.js";
import { SERVICE_HISTORY_REFERENCES, SERVICE_HISTORY_IMPORT_CONTRACT } from "../dataImport/contracts/serviceHistoryImportContract.js";
import {
  acceptOnly, companyOptions, inTransaction, isPlainObject, reachableCompanies, recordsAudit, refuse, requireCapability, ID_SHAPE, type RecordsActor,
} from "./recordsSupport.js";

const SCHEMA = "eos_ops";

/** The one capability: Data Import is Administration tooling held by the Administrator alone (Owner-excluded, ruling A). */
export const DATA_IMPORT_CAPABILITY = "admin.dataImport.execute";
/** The only entity wired on EOS in this batch. */
export const WIRED_IMPORT_ENTITY: ImportEntityType = "SERVICE_HISTORY";
const HISTORY_LIMIT = 25;

/** The environment a job is staged against. Execution refuses a job prepared for another. EOS refuses to start against production at all. */
const targetEnvironment = (): string => (process.env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase() || "local";

const newJobId = (now: Date): string => {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `IMP-${stamp}-${randomBytes(4).toString("hex").toUpperCase()}`;
};

/** A client may send null (deliberately unmapped) for a column; anything that is not a non-empty string becomes null rather than being trusted. */
function asMapping(value: unknown): ColumnMapping | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) return refuse("MAPPING_INVALID", "INVALID_INPUT", "mapping must be an object keyed by source column");
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(value)) out[k] = typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  return Object.freeze(out);
}

/** The operating company a staged file belongs to: the caller's own reach, chosen or (when it reaches exactly one) implied. */
function chosenCompany(requested: unknown, keys: readonly string[]): string {
  if (requested === undefined || requested === null || requested === "") {
    if (keys.length === 1) return keys[0];
    return refuse("COMPANY_REQUIRED", "INVALID_INPUT", "state the operating company this file's records belong to (operatingCompanyKey)");
  }
  // A company the caller does not reach reads exactly as one that does not exist.
  if (typeof requested !== "string" || !keys.includes(requested)) return refuse("COMPANY_NOT_FOUND", "NOT_FOUND", "operating company not found");
  return requested;
}

interface StoredJobRow {
  readonly job: ImportJob;
  readonly operatingCompanyKey: string;
}

async function loadJob(db: Pick<PoolClient, "query">, tenantId: string, jobId: string, keys: readonly string[]): Promise<StoredJobRow | null> {
  const { rows } = await db.query(
    `SELECT job, operating_company_key FROM ${SCHEMA}.data_import_jobs
      WHERE tenant_id = $1 AND job_id = $2 AND operating_company_key = ANY($3::text[])`, [tenantId, jobId, [...keys]]);
  return rows.length === 0 ? null : { job: rows[0].job as ImportJob, operatingCompanyKey: String(rows[0].operating_company_key) };
}

const withCompany = (job: ImportJob, operatingCompanyKey: string) => ({ ...job, operatingCompanyKey });

// ════════════════════ STAGE ════════════════════

/**
 * STAGE. Parse, detect, map, validate, preview, and persist the job. Writes NO business record: the only row it creates is the import job, the
 * record of a proposal, not of a service record.
 */
export async function stageDataImport(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, DATA_IMPORT_CAPABILITY);
  const d = acceptOnly(input, ["fileName", "fileText", "fileBase64", "entityType", "mapping", "operatingCompanyKey"]);
  const fileName = typeof d.fileName === "string" ? d.fileName : "";
  const fileText = typeof d.fileText === "string" ? d.fileText : "";
  const fileBase64 = typeof d.fileBase64 === "string" ? d.fileBase64 : "";
  if (!fileName || (!fileText && !fileBase64)) refuse("FILE_REQUIRED", "INVALID_INPUT", "fileName and either fileText or fileBase64 are required");

  // WHICH READER IS CHOSEN BY THE ENCODING, NOT BY THE FILENAME: a .xlsx is binary and arrives base64, a CSV is text. Both readers still check the extension.
  let parsed: ReturnType<typeof parseSourceFile>;
  try {
    parsed = fileBase64 ? parseWorkbookFile(fileName, Buffer.from(fileBase64, "base64")) : parseSourceFile(fileName, fileText);
  } catch (err) {
    // Intake failures are the ONE class surfaced with their own message: they describe the caller's own file and are useless generically.
    if (err instanceof IntakeError) return refuse(err.code, "INVALID_INPUT", err.message);
    throw err;
  }

  const detection = detectEntityType(parsed.columns);
  const requested = typeof d.entityType === "string" ? (d.entityType as ImportEntityType) : null;
  const entityType = requested ?? detection.entityType;
  if (!entityType) return refuse("ENTITY_UNDETERMINED", "PRECONDITION_FAILED", "the entity could not be detected from the file; choose one");
  const contract = entityContractFor(entityType);
  if (!contract || entityType !== WIRED_IMPORT_ENTITY) {
    // An honest refusal before anything is staged: a job nothing on EOS can execute is never created.
    return refuse("ENTITY_NOT_WIRED", "PRECONDITION_FAILED", `Import for ${entityType} is not available on EOS yet. Only service history can be imported here.`);
  }

  const suggestions = suggestMapping(entityType, parsed);
  const provided = asMapping(d.mapping);
  const mapping: ColumnMapping = provided ?? Object.freeze(Object.fromEntries(suggestions.map((s) => [s.sourceColumn, s.canonicalField])));
  const validation = validateMapping(entityType, parsed, mapping);
  if (!validation.valid) {
    // A mapping that cannot produce a record is not a preview with errors -- there is nothing to preview. Returned as data (not a job).
    return { staged: false as const, entityType, detection, columns: parsed.columns, suggestions, mapping, validation };
  }
  const rows = projectRows(parsed, mapping);

  return inTransaction(deps.pool, "write", async (c) => {
    const reach = await reachableCompanies(c, actor);
    const company = chosenCompany(d.operatingCompanyKey, reach.keys);
    // The customers a file may point at, and the records already imported for THIS company (an import never overwrites).
    const accounts = await c.query(`SELECT name FROM eos_crm.accounts WHERE tenant_id = $1`, [actor.tenantId]);
    const customers = new Set<string>(accounts.rows.map((r) => naturalIdentityKey(r.name)).filter((k) => k !== ""));
    const known = await c.query(
      `SELECT identity_key FROM ${SCHEMA}.imported_service_history WHERE tenant_id = $1 AND operating_company_key = $2`, [actor.tenantId, company]);
    const existing = new Set<string>(known.rows.map((r) => String(r.identity_key)));
    const preview = buildEntityPreview(entityType, rows, { existing, references: Object.freeze({ [SERVICE_HISTORY_REFERENCES.CUSTOMER]: customers }) });

    const now = new Date();
    const job = stageImportJob({
      jobId: newJobId(now), preview, fileName, targetProjectId: targetEnvironment(), headerSignature: headerSignature(parsed.columns),
      sourceColumns: parsed.columns,
      // Drop the nulls: a stored mapping is the record of what WAS mapped.
      mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => typeof v === "string")) as Record<string, string>,
      stagedBy: actor.principalId, stagedAt: now.toISOString(),
    });
    await c.query(
      `INSERT INTO ${SCHEMA}.data_import_jobs (tenant_id, job_id, operating_company_key, entity_type, status, file_name, target_environment, staged_by, staged_at, job)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [actor.tenantId, job.jobId, company, job.entityType, job.status, job.fileName, job.targetProjectId, actor.principalId, job.stagedAt, JSON.stringify(job)]);
    await recordsAudit(c, actor, "dataImport.stage", "data_import_job", job.jobId,
      { entityType: job.entityType, fileName: job.fileName, operatingCompanyKey: company, summary: job.summary }, `Data import ${job.jobId} staged (${job.fileName}).`);
    return { staged: true as const, detection, suggestions, validation, job: withCompany(job, company) };
  });
}

// ════════════════════ EXECUTE ════════════════════

/** ONE service-history record, written under the job's company. Customer resolution is by the unique name match the preview used. */
function serviceHistoryWriter(
  pool: Pool, actor: RecordsActor, companyKey: string, jobId: string, accountsByName: ReadonlyMap<string, readonly string[]>,
): RowWriter {
  return {
    async write(draft, idempotencyKey) {
      try {
        const customerName = String(draft.customerName ?? "");
        const matches = accountsByName.get(naturalIdentityKey(customerName)) ?? [];
        // Two customers with one name is a question, not a resolution.
        if (matches.length !== 1) return { kind: "failed", code: "CUSTOMER_NOT_FOUND", message: `No single customer named "${customerName}" exists.` };
        // Recomputed from the CONTRACT rather than passed in: the stored key and the key preview compared against are the same function.
        const identityKey = SERVICE_HISTORY_IMPORT_CONTRACT.identityKey(draft);
        const id = `SH-${idempotencyKey}`;
        return await inTransaction(pool, "write", async (c) => {
          const ins = await c.query(
            `INSERT INTO ${SCHEMA}.imported_service_history
               (tenant_id, id, account_id, operating_company_key, identity_key, service_date, summary, external_reference, technician_name,
                equipment_serial_number, location_name, source_system, import_job_id, imported_by)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, 'DATA_IMPORT', $12, $13)
             ON CONFLICT (tenant_id, id) DO NOTHING RETURNING id`,
            [actor.tenantId, id, matches[0], companyKey, identityKey, String(draft.serviceDate), String(draft.summary),
              draft.externalReference ?? null, draft.technicianName ?? null, draft.equipmentSerialNumber ?? null, draft.locationName ?? null,
              jobId, actor.principalId]);
          // A row of this job already written (a retry of the same job row) wrote nothing this time.
          if (ins.rows.length === 0) return { kind: "replayed" as const };
          await recordsAudit(c, actor, "dataImport.serviceHistory.create", "imported_service_history", id,
            { accountId: matches[0], operatingCompanyKey: companyKey, serviceDate: String(draft.serviceDate), importJobId: jobId },
            `Historical service record for "${customerName}" on ${String(draft.serviceDate)} imported (${jobId}).`);
          return { kind: "created" as const };
        });
      } catch (err) {
        // The company's identity key already holds this record: it is refused, never overwritten.
        if ((err as { code?: string; constraint?: string })?.constraint === "imported_service_history_identity_unique") {
          return { kind: "failed", code: "ALREADY_EXISTS", message: "A service record with this identity has already been imported." };
        }
        return { kind: "failed", code: "UNEXPECTED", message: "The record could not be written." };
      }
    },
  };
}

/**
 * EXECUTE. Turns an approved staged job into governed records. The rows written are the ones the job STORED at staging -- never anything re-sent by
 * the client; that is what makes the approval an approval of a specific preview.
 */
export async function executeDataImport(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, DATA_IMPORT_CAPABILITY);
  const d = acceptOnly(input, ["jobId", "approved"]);
  if (!ID_SHAPE(d.jobId)) refuse("JOB_ID_REQUIRED", "INVALID_INPUT", "jobId is required");
  if (d.approved !== true) refuse("NOT_APPROVED", "PRECONDITION_FAILED", "the import must be explicitly approved before it can run");
  const jobId = d.jobId as string;

  const loaded = await inTransaction(deps.pool, "snapshot", async (c) => {
    const reach = await reachableCompanies(c, actor);
    const stored = await loadJob(c, actor.tenantId, jobId, reach.keys);
    const accounts = await c.query(`SELECT id, name FROM eos_crm.accounts WHERE tenant_id = $1`, [actor.tenantId]);
    return { stored, accounts: accounts.rows };
  });
  const stored = loaded.stored;
  if (stored === null) return refuse("JOB_NOT_FOUND", "NOT_FOUND", "no such import job");

  let staged: ImportJob;
  try {
    staged = assertExecutable(stored.job, targetEnvironment());
  } catch (err) {
    if (err instanceof ImportJobError) return refuse(err.code, err.code === "JOB_NOT_FOUND" ? "NOT_FOUND" : "PRECONDITION_FAILED", err.message);
    throw err;
  }
  if (staged.entityType !== WIRED_IMPORT_ENTITY) {
    return refuse("ENTITY_NOT_WIRED", "PRECONDITION_FAILED", `Import for ${staged.entityType} is not available on EOS yet.`);
  }

  // CLAIM: STAGED -> EXECUTING in one conditional UPDATE. A second approval of the same job (two administrators, a double click) matches no row.
  const claimed = beginExecution(staged, actor.principalId, new Date().toISOString());
  const claim = await deps.pool.query(
    `UPDATE ${SCHEMA}.data_import_jobs SET status = 'EXECUTING', approved_by = $4, approved_at = $5, job = $6::jsonb
      WHERE tenant_id = $1 AND job_id = $2 AND operating_company_key = $3 AND status = 'STAGED' RETURNING job_id`,
    [actor.tenantId, jobId, stored.operatingCompanyKey, actor.principalId, claimed.approvedAt, JSON.stringify(claimed)]);
  if (claim.rows.length === 0) refuse("JOB_NOT_STAGED", "CONFLICT", "this import is already running or has already run");

  const accountsByName = new Map<string, string[]>();
  for (const a of loaded.accounts) {
    const key = naturalIdentityKey(a.name);
    if (key === "") continue;
    accountsByName.set(key, [...(accountsByName.get(key) ?? []), String(a.id)]);
  }
  const rowResults = await executeImportJob(claimed, serviceHistoryWriter(deps.pool, actor, stored.operatingCompanyKey, jobId, accountsByName));
  const finished = finishExecution(claimed, rowResults);
  await inTransaction(deps.pool, "write", async (c) => {
    await c.query(
      `UPDATE ${SCHEMA}.data_import_jobs SET status = $4, job = $5::jsonb WHERE tenant_id = $1 AND job_id = $2 AND operating_company_key = $3`,
      [actor.tenantId, jobId, stored.operatingCompanyKey, finished.status, JSON.stringify(finished)]);
    await recordsAudit(c, actor, "dataImport.execute", "data_import_job", jobId,
      { status: finished.status, created: finished.result?.created ?? 0, replayed: finished.result?.replayed ?? 0, failed: finished.result?.failed ?? 0 },
      `Data import ${jobId} approved and run.`);
  });
  return { job: withCompany(finished, stored.operatingCompanyKey) };
}

// ════════════════════ HISTORY ════════════════════

/** The caller's companies' recent jobs, newest first, with the companies a new file may be staged for and the intake limits. Read-only. */
export async function listDataImportJobs(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, DATA_IMPORT_CAPABILITY);
  acceptOnly(input, []);
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const reach = await reachableCompanies(c, actor);
    const { rows } = await c.query(
      `SELECT job, operating_company_key FROM ${SCHEMA}.data_import_jobs
        WHERE tenant_id = $1 AND operating_company_key = ANY($2::text[]) ORDER BY staged_at DESC, job_id LIMIT ${HISTORY_LIMIT}`,
      [actor.tenantId, [...reach.keys]]);
    return {
      jobs: rows.map((r) => withCompany(r.job as ImportJob, String(r.operating_company_key))),
      limits: IMPORT_LIMITS,
      companies: await companyOptions(c, actor.tenantId, reach.keys),
      wiredEntities: [WIRED_IMPORT_ENTITY],
    };
  });
}
