// SYSTEM CONFIGURATION THROUGH ADMINISTRATION (Owner ruling #204, 2026-10-03). Served by /admin/policy as
// ADMIN_CONFIGURATION_OPERATIONS, gated on `admin.systemConfiguration.manage` (SYSTEM ADMINISTRATION authority -- it confers no
// business approval).
//
// ONE REGISTRY, NOT ONE ARCHITECTURE PER SETTING. eos_policy.configuration_setting_definitions names every governed setting
// (scope, value kind, where it is kept, its default). Today, per operating company:
//   businessTimeZone  IANA zone, kept on tenant_operating_companies (the business-date resolver reads it there);
//   defaultLanguage   a tag from eos_policy.supported_languages, kept in eos_policy.operating_company_settings.
// A future company setting is a definition row plus a validator below. Business-specific configuration (accounting
// destinations, payment terms, Sales discount authority) stays with its own domain and its own capability.
//
// Every change is server-validated (the database re-checks), audited with its reason, company-scoped and Firebase-free.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ConfigurationRefusal, type AdminConfigurationOperation, type ConfigurationActor } from "../adminPolicy/configurationOperations";
import { withActorAuthority } from "./administrationReach";

export const SYSTEM_CONFIGURATION_OPERATIONS = Object.freeze(["listSystemConfiguration", "setSystemConfigurationSetting"] as const);
export const isSystemConfigurationOperation = (op: string): boolean => (SYSTEM_CONFIGURATION_OPERATIONS as readonly string[]).includes(op);

type Category = "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN";
const refuse = (code: string, category: Category, message: string): never => {
  throw new ConfigurationRefusal(code, category, message);
};
const only = (i: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const k of Object.keys(i)) if (!allowed.includes(k)) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
};
const text = (v: unknown, name: string, max = 100): string => {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse("INVALID_INPUT", "INVALID_INPUT", `${name} is required`);
  return (v as string).trim();
};

interface SettingDefinition { setting_key: string; scope_kind: string; value_kind: "IANA_TIME_ZONE" | "LANGUAGE_TAG"; storage: "OPERATING_COMPANY_COLUMN" | "SETTINGS_TABLE"; default_value: string; display_label: string }

/** The column a definition kept on the company row lives in. Closed: a new column-kept setting is added here deliberately. */
const COMPANY_COLUMN: Readonly<Record<string, string>> = Object.freeze({ businessTimeZone: "business_time_zone" });

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function definitions(db: Pick<PoolClient, "query">): Promise<SettingDefinition[]> {
  return (await db.query<SettingDefinition>(`SELECT * FROM eos_policy.configuration_setting_definitions ORDER BY setting_key`)).rows;
}

async function validate(db: Pick<PoolClient, "query">, def: SettingDefinition, value: string): Promise<void> {
  if (def.value_kind === "IANA_TIME_ZONE") {
    const { rowCount } = await db.query(`SELECT 1 FROM pg_timezone_names WHERE name = $1`, [value]);
    if (!rowCount) refuse("BUSINESS_TIME_ZONE_UNKNOWN", "INVALID_INPUT", `${value} is not an IANA time zone`);
  } else if (def.value_kind === "LANGUAGE_TAG") {
    const { rowCount } = await db.query(`SELECT 1 FROM eos_policy.supported_languages WHERE language_tag = $1 AND status = 'ACTIVE'`, [value]);
    if (!rowCount) refuse("LANGUAGE_UNSUPPORTED", "INVALID_INPUT", `${value} is not a supported language`);
  } else {
    refuse("CONFIGURATION_SETTING_INVALID", "INVALID_INPUT", `${def.setting_key} has no validator`);
  }
}

async function listSystemConfiguration(pool: Pool, actor: ConfigurationActor, i: Record<string, unknown>) {
  only(i, []);
  const defs = await definitions(pool);
  const { rows: companies } = await pool.query(`SELECT operating_company_id, status, business_time_zone FROM eos_policy.tenant_operating_companies
    WHERE tenant_id = $1 ORDER BY operating_company_id`, [actor.tenantId]);
  const { rows: stored } = await pool.query(`SELECT operating_company_id, setting_key, value, updated_by, updated_at FROM eos_policy.operating_company_settings
    WHERE tenant_id = $1`, [actor.tenantId]);
  const { rows: languages } = await pool.query(`SELECT language_tag, display_name FROM eos_policy.supported_languages WHERE status = 'ACTIVE' ORDER BY language_tag`);
  return Object.freeze({
    settings: defs.map((d) => Object.freeze({ settingKey: d.setting_key, scope: d.scope_kind, valueKind: d.value_kind, label: d.display_label, defaultValue: d.default_value })),
    supportedLanguages: languages.map((l) => Object.freeze({ languageTag: l.language_tag, displayName: l.display_name })),
    companies: companies.map((c) => Object.freeze({
      operatingCompanyId: c.operating_company_id, status: c.status,
      values: Object.freeze(Object.fromEntries(defs.map((d) => {
        if (d.storage === "OPERATING_COMPANY_COLUMN") return [d.setting_key, Object.freeze({ value: c[COMPANY_COLUMN[d.setting_key]], source: "CONFIGURED_OR_DEFAULT" })];
        const row = stored.find((s) => s.operating_company_id === c.operating_company_id && s.setting_key === d.setting_key);
        return [d.setting_key, Object.freeze(row ? { value: row.value, source: "CONFIGURED" } : { value: d.default_value, source: "DEFAULT" })];
      }))),
    })),
  });
}

async function setSystemConfigurationSetting(pool: Pool, actor: ConfigurationActor, i: Record<string, unknown>, reason: string | null) {
  only(i, ["operatingCompanyId", "settingKey", "value"]);
  if (typeof reason !== "string" || reason.trim() === "") refuse("REASON_REQUIRED", "INVALID_INPUT", "a system configuration change states its reason");
  const companyId = text(i.operatingCompanyId, "operatingCompanyId");
  const key = text(i.settingKey, "settingKey");
  const value = text(i.value, "value");
  return tx(pool, async (c) => {
    const def = (await definitions(c)).find((d) => d.setting_key === key) ?? refuse("CONFIGURATION_SETTING_UNKNOWN", "INVALID_INPUT", `${key} is not a governed setting`);
    const { rows: co } = await c.query(`SELECT * FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 FOR UPDATE`,
      [actor.tenantId, companyId]);
    if (!co[0]) refuse("OPERATING_COMPANY_UNRESOLVED", "NOT_FOUND", `${companyId} is not an operating company of this tenant`);
    await validate(c, def, value);
    let previous: string;
    if (def.storage === "OPERATING_COMPANY_COLUMN") {
      const column = COMPANY_COLUMN[def.setting_key] ?? refuse("CONFIGURATION_SETTING_INVALID", "INVALID_INPUT", `${key} has no company column`);
      previous = co[0][column];
      await c.query(`UPDATE eos_policy.tenant_operating_companies SET ${column} = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND operating_company_id = $2`,
        [actor.tenantId, companyId, value, actor.principalId]);
    } else {
      const { rows: before } = await c.query(`SELECT value FROM eos_policy.operating_company_settings WHERE tenant_id = $1 AND operating_company_id = $2 AND setting_key = $3 FOR UPDATE`,
        [actor.tenantId, companyId, key]);
      previous = before[0]?.value ?? def.default_value;
      await c.query(`INSERT INTO eos_policy.operating_company_settings (tenant_id, operating_company_id, setting_key, value, updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id, operating_company_id, setting_key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [actor.tenantId, companyId, key, value, actor.principalId]);
    }
    await c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
                   VALUES ($1,$2,'admin.systemConfiguration.set',$3,'operating_company_setting',$4,$5::jsonb,$6::jsonb,now(),$7)`,
      [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, `${companyId}:${key}`, JSON.stringify({ [key]: previous }), JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, { [key]: value })), (reason as string).trim()]);
    return Object.freeze({ operatingCompanyId: companyId, settingKey: key, value, previous,
      appliesTo: def.value_kind === "IANA_TIME_ZONE" ? "FUTURE_BUSINESS_DATES" as const : "FUTURE_SESSIONS" as const });
  });
}

export function createSystemConfigurationAdministration(pool: Pool) {
  return async (operation: AdminConfigurationOperation, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null): Promise<unknown> => {
    const { reason: _stated, ...i } = input && typeof input === "object" && !Array.isArray(input) ? input : ({} as Record<string, unknown>);
    void _stated;
    switch (operation) {
      case "listSystemConfiguration": return listSystemConfiguration(pool, actor, i);
      case "setSystemConfigurationSetting": return setSystemConfigurationSetting(pool, actor, i, reason);
      default: throw new Error(`not a system configuration operation: ${String(operation)}`);
    }
  };
}
