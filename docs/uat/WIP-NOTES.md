# UAT role x object census -- WIP notes (lane UAT, phase 1). Not final; replaced by README.md when the lane completes.

Branch `uat/role-object-census` from origin/main 835e5982. Read-only lane: docs only, no grants, no nonprod writes, no credentials, no Postgres.

Done so far (tools only; no generated docs yet):
- `tools/uatExtract.mjs` parses the 40 experience surfaces, the closed API operation registries (452 route+operation pairs), the scope-evaluable grants and the 92 navigation destinations.
- `tools/uatMaps.mjs` maps operations and pages to Objects (name-based, confidence N/A).
- `tools/uatProbes.mjs` is the direct-API probe catalogue (operation + named capability).
- `tools/uatModel.mjs` computes A (roles, personas), B (objects, reconciliation), C (persona capability, CRED, workflow, probe expectations).

Findings so far (verify when regenerating): 20 roles with no active assignee; 8 principals with no active role; persona generalEmployee holds 0 capabilities;
57 CRED-vs-capability divergences, 40 CRED-only cells, 10 edit/create-without-read rows; 26 built pages with no governed surface (invisible under the EOS navigation source);
salesAgreement workflow bindings 19 in nonprod vs 6 in the seed; census omits 4 Objects that capabilities reference (crmActivity, inventoryReturn, performanceGoal, report).

Still to do: generator main + renderers; docs/uat/codex-handoff/{README.md, expected-access-manifest.json, role-inventory.md, object-inventory.md, effective-access-matrix.md, test-plan.md, report-template.md};
docs/uat/{05-ventana-fixture-plan.md, tools/ventana-uat-fixture.mjs + spec, 06-coverage-denominators.md, 07-owner-questions.md, 08-active-workstreams-reconciliation.md, README.md}; ACTIVE_WORKSTREAMS row; evidence copies under D:/eos-lanes/evidence/uat/; PR (do not merge).

Hard rules to carry into the Codex README (Owner directions 2026-10-21): MFA is explicit (password step must return MFA_REQUIRED and the second factor must complete; password-only session for an MFA persona is a SECURITY FAILURE);
loginEosPersona() is API auth, distinct from a Playwright login through the real EOS login and MFA screens; EOS_PERSONA_ISSUER_CREDENTIAL is for direct-API authorization tests only and is never login proof;
harness finding: scripts/eosPersonaSession.mjs lines 33-34 return an explicit baseUrl / EOS_API_BASE_URL before the production-role check at line 38 (and options.origin at line 143 is unchecked) -- cite as a finding, controller fixes;
never persist storageState/trace/HAR, mask inputs; EOS_PERSONA_CREDENTIALS_FILE set explicitly by the operator, no credential search; missing MFA enrollment = BLOCKED, never re-enroll; one isolated context per persona;
after login verify Principal, Employee, Security Roles and company authority against the manifest; report browser-login proof and API authority proof in separate sections.
