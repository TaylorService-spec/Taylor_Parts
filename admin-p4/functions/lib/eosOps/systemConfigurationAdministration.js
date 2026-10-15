"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSystemConfigurationOperation = exports.SYSTEM_CONFIGURATION_OPERATIONS = void 0;
exports.createSystemConfigurationAdministration = createSystemConfigurationAdministration;
const node_crypto_1 = require("node:crypto");
const configurationOperations_1 = require("../adminPolicy/configurationOperations");
exports.SYSTEM_CONFIGURATION_OPERATIONS = Object.freeze(["listSystemConfiguration", "setSystemConfigurationSetting"]);
const isSystemConfigurationOperation = (op) => exports.SYSTEM_CONFIGURATION_OPERATIONS.includes(op);
exports.isSystemConfigurationOperation = isSystemConfigurationOperation;
const refuse = (code, category, message) => {
    throw new configurationOperations_1.ConfigurationRefusal(code, category, message);
};
const only = (i, allowed) => {
    for (const k of Object.keys(i))
        if (!allowed.includes(k))
            refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
};
const text = (v, name, max = 100) => {
    if (typeof v !== "string" || v.trim() === "" || v.length > max)
        refuse("INVALID_INPUT", "INVALID_INPUT", `${name} is required`);
    return v.trim();
};
/** The column a definition kept on the company row lives in. Closed: a new column-kept setting is added here deliberately. */
const COMPANY_COLUMN = Object.freeze({ businessTimeZone: "business_time_zone" });
async function tx(pool, fn) {
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
    }
    catch (err) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        c.release();
    }
}
async function definitions(db) {
    return (await db.query(`SELECT * FROM eos_policy.configuration_setting_definitions ORDER BY setting_key`)).rows;
}
async function validate(db, def, value) {
    if (def.value_kind === "IANA_TIME_ZONE") {
        const { rowCount } = await db.query(`SELECT 1 FROM pg_timezone_names WHERE name = $1`, [value]);
        if (!rowCount)
            refuse("BUSINESS_TIME_ZONE_UNKNOWN", "INVALID_INPUT", `${value} is not an IANA time zone`);
    }
    else if (def.value_kind === "LANGUAGE_TAG") {
        const { rowCount } = await db.query(`SELECT 1 FROM eos_policy.supported_languages WHERE language_tag = $1 AND status = 'ACTIVE'`, [value]);
        if (!rowCount)
            refuse("LANGUAGE_UNSUPPORTED", "INVALID_INPUT", `${value} is not a supported language`);
    }
    else {
        refuse("CONFIGURATION_SETTING_INVALID", "INVALID_INPUT", `${def.setting_key} has no validator`);
    }
}
async function listSystemConfiguration(pool, actor, i) {
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
                if (d.storage === "OPERATING_COMPANY_COLUMN")
                    return [d.setting_key, Object.freeze({ value: c[COMPANY_COLUMN[d.setting_key]], source: "CONFIGURED_OR_DEFAULT" })];
                const row = stored.find((s) => s.operating_company_id === c.operating_company_id && s.setting_key === d.setting_key);
                return [d.setting_key, Object.freeze(row ? { value: row.value, source: "CONFIGURED" } : { value: d.default_value, source: "DEFAULT" })];
            }))),
        })),
    });
}
async function setSystemConfigurationSetting(pool, actor, i, reason) {
    only(i, ["operatingCompanyId", "settingKey", "value"]);
    if (typeof reason !== "string" || reason.trim() === "")
        refuse("REASON_REQUIRED", "INVALID_INPUT", "a system configuration change states its reason");
    const companyId = text(i.operatingCompanyId, "operatingCompanyId");
    const key = text(i.settingKey, "settingKey");
    const value = text(i.value, "value");
    return tx(pool, async (c) => {
        const def = (await definitions(c)).find((d) => d.setting_key === key) ?? refuse("CONFIGURATION_SETTING_UNKNOWN", "INVALID_INPUT", `${key} is not a governed setting`);
        const { rows: co } = await c.query(`SELECT * FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 FOR UPDATE`, [actor.tenantId, companyId]);
        if (!co[0])
            refuse("OPERATING_COMPANY_UNRESOLVED", "NOT_FOUND", `${companyId} is not an operating company of this tenant`);
        await validate(c, def, value);
        let previous;
        if (def.storage === "OPERATING_COMPANY_COLUMN") {
            const column = COMPANY_COLUMN[def.setting_key] ?? refuse("CONFIGURATION_SETTING_INVALID", "INVALID_INPUT", `${key} has no company column`);
            previous = co[0][column];
            await c.query(`UPDATE eos_policy.tenant_operating_companies SET ${column} = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND operating_company_id = $2`, [actor.tenantId, companyId, value, actor.principalId]);
        }
        else {
            const { rows: before } = await c.query(`SELECT value FROM eos_policy.operating_company_settings WHERE tenant_id = $1 AND operating_company_id = $2 AND setting_key = $3 FOR UPDATE`, [actor.tenantId, companyId, key]);
            previous = before[0]?.value ?? def.default_value;
            await c.query(`INSERT INTO eos_policy.operating_company_settings (tenant_id, operating_company_id, setting_key, value, updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id, operating_company_id, setting_key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [actor.tenantId, companyId, key, value, actor.principalId]);
        }
        await c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
                   VALUES ($1,$2,'admin.systemConfiguration.set',$3,'operating_company_setting',$4,$5::jsonb,$6::jsonb,now(),$7)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, actor.principalId, `${companyId}:${key}`, JSON.stringify({ [key]: previous }), JSON.stringify({ [key]: value }), reason.trim()]);
        return Object.freeze({ operatingCompanyId: companyId, settingKey: key, value, previous,
            appliesTo: def.value_kind === "IANA_TIME_ZONE" ? "FUTURE_BUSINESS_DATES" : "FUTURE_SESSIONS" });
    });
}
function createSystemConfigurationAdministration(pool) {
    return async (operation, actor, input, reason) => {
        const { reason: _stated, ...i } = input && typeof input === "object" && !Array.isArray(input) ? input : {};
        void _stated;
        switch (operation) {
            case "listSystemConfiguration": return listSystemConfiguration(pool, actor, i);
            case "setSystemConfigurationSetting": return setSystemConfigurationSetting(pool, actor, i, reason);
            default: throw new Error(`not a system configuration operation: ${String(operation)}`);
        }
    };
}
//# sourceMappingURL=systemConfigurationAdministration.js.map