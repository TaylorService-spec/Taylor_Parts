// SAMPLE COMPANY V2 -- the CREDENTIAL ACTIVATION phase. Delegated, scoped, and separately authorized.
//
// ============================ NO SECOND IMPLEMENTATION ============================
//
// Password activation is NOT reimplemented here. This module resolves WHICH accounts the Sample Company is
// allowed to touch and then calls `activateMissingSandboxPasswords` from
// functions/scripts/activateSandboxPersonas.js -- the same function that script's own `--activate-missing`
// CLI calls, unchanged. There is one password-generating code path in the repository and this is not it: a
// second copy would be a second thing to keep honest about rotation, merge semantics and file handling, and
// the first time the two drifted the symptom would be "invalid password" with no clue which one was wrong.
//
// ============================ SCOPED TO THIS SAMPLE COMPANY ============================
//
// The standalone CLI considers EVERY @sandbox.invalid account in the project, which is right for the
// operator running it deliberately and wrong as a side effect of seeding one fictional company. So this
// phase passes an EXPLICIT ALLOWLIST: exactly the manifest Employees with sandboxPersona.interactiveLogin,
// and nothing else. An account outside that list cannot be reached, because the allowlist is an intersection
// rather than a filter the caller could widen.
//
// THE REUSED REAL ADMINISTRATOR IS EXCLUDED. Its credential is real, pre-existing and out of scope for this
// workstream: no Owner policy authorizes activating it, so it is not in the allowlist and its
// `credentialEmail` is null in the manifest precisely so it cannot accidentally become one.
//
// A MISSING ACCOUNT IS A FINDING, NOT A SKIP. An allowlisted persona with no Auth account is reported and
// fails the phase: somebody is being told they can log in as that persona, and they cannot.
//
// NOTHING HERE RETURNS, LOGS OR COMMITS A PASSWORD. The result carries email addresses and counts.
"use strict";

class CredentialActivationError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CredentialActivationError";
    this.code = code;
  }
}

/**
 * The addresses this Sample Company may activate: interactive personas only, with BOTH reused real
 * Principals excluded. The administrator's credential and the owner's credential are real, pre-existing and
 * out of scope, and both carry a null credentialEmail so neither could become an allowlist entry anyway --
 * the filter states the rule rather than relying on that.
 */
function sampleCompanyCredentialAllowlist(manifest) {
  const employees = new Map(manifest.employees.map((e) => [e.key, e]));
  const allowlist = manifest.principals
    .filter((p) => !p.existingAdministrator && !p.existingOwnerPrincipal)
    .filter((p) => employees.get(p.employee)?.sandboxPersona?.interactiveLogin === true)
    .map((p) => p.loginPrincipal.credentialEmail)
    .filter((email) => typeof email === "string" && email.length > 0)
    .sort();

  // ============================ THE SUPERSESSION FENCE ============================
  //
  // OWNER RULING 2026-09-25. An address the manifest still declares may have been SUPERSEDED by an
  // account that already exists. Three are, and each would have done real damage here:
  //
  //   sage.fixture@ / wren.fixture@  do not exist in eos-platform-sandbox at all, so activate-logins
  //                                  would have CREATED them -- a brand new persona account for an
  //                                  identity that already has a perfectly good one, which is the
  //                                  duplicate the Owner ruled out (duplicates created = 0).
  //   emerson.fixture@               exists but has NO EOS Principal, while the live Dispatcher
  //                                  Principal sits behind dispatcher@. Activating it would put a
  //                                  working password on the WRONG identity -- the failure that
  //                                  surfaces later as a surprising authorization answer.
  //
  // EXCLUDED, NOT REFUSED. Throwing here would block the ten personas that are legitimately
  // activatable along with the three that are not, which serves nobody. Excluded is not the same as
  // silent: `supersededExclusions()` returns exactly what was dropped and why, and the activation
  // result carries it, so the phase reports the divergence between manifest and ruling every run.
  const superseded = manifest.sandboxCredentials?.supersededIdentities ?? {};
  return allowlist.filter((email) => !superseded[email]);
}

/**
 * What the supersession fence removed from the allowlist, and why. Returned by the activation phase
 * so a run can never drop an identity without saying so.
 */
function supersededExclusions(manifest) {
  const employees = new Map(manifest.employees.map((e) => [e.key, e]));
  const superseded = manifest.sandboxCredentials?.supersededIdentities ?? {};
  return manifest.principals
    .filter((p) => !p.existingAdministrator && !p.existingOwnerPrincipal)
    .filter((p) => employees.get(p.employee)?.sandboxPersona?.interactiveLogin === true)
    .map((p) => p.loginPrincipal.credentialEmail)
    .filter((email) => typeof email === "string" && superseded[email])
    .sort()
    .map((email) => ({
      email,
      disposition: superseded[email].disposition,
      supersededBy: superseded[email].supersededBy,
      existsInProject: superseded[email].existsInProject,
    }));
}

/**
 * Activate the Sample Company's own sandbox credentials, and only those.
 *
 * DRY RUN BY DEFAULT: with `apply` false nothing is written to Auth and nothing is written to the credential
 * file; the report says which personas WOULD be activated and which are already usable.
 */
async function activateSampleCompanyCredentials(options, manifest, authDirectory, activator) {
  const apply = options.apply === true;
  const allowlist = sampleCompanyCredentialAllowlist(manifest);
  if (allowlist.length === 0) {
    throw new CredentialActivationError("NO_INTERACTIVE_PERSONAS", "this manifest declares no interactive persona to activate");
  }
  const personas = await authDirectory.listSandboxPersonas();
  const inScope = personas.filter((u) => allowlist.includes(u.email));
  const missing = allowlist.filter((email) => !personas.some((u) => u.email === email));
  const alreadyUsable = inScope.filter((u) => u.passwordHash).map((u) => u.email).sort();
  const needingActivation = inScope.filter((u) => !u.passwordHash).map((u) => u.email).sort();

  const supersededExcluded = supersededExclusions(manifest);
  const base = {
    phase: "activate-credentials",
    supersededExcluded,
    applied: apply,
    firebaseProjectId: authDirectory.projectId,
    delegatedTo: "functions/scripts/activateSandboxPersonas.js activateMissingSandboxPasswords (the same function its --activate-missing CLI calls)",
    scope: "ALLOWLIST",
    allowlist,
    outOfScopeSandboxAccounts: personas.length - inScope.length,
    missing,
    credentialFile: options.credentialFile,
  };

  if (missing.length > 0) {
    // Reported, never skipped: a persona somebody expects to sign in as, whose account does not exist.
    return {
      ...base,
      activated: [],
      alreadyUsable,
      wouldActivate: needingActivation,
      pass: false,
      refusal: "SANDBOX_ACCOUNT_MISSING: run --mode activate-logins --apply first; it creates the passwordless accounts this phase activates",
    };
  }

  if (!apply) {
    return { ...base, activated: [], alreadyUsable, wouldActivate: needingActivation, pass: true };
  }

  // THE EXISTING IMPLEMENTATION, called with our allowlist. It generates a password ONLY where there is
  // none, leaves every working persona untouched, and merges into the gitignored file.
  const result = await activator({
    auth: authDirectory.auth,
    personas,
    outPath: options.credentialFile,
    emailAllowlist: allowlist,
  });
  if (result.activated.some((email) => !allowlist.includes(email))) {
    throw new CredentialActivationError("SCOPE_VIOLATION", "the activation touched an account outside the Sample Company allowlist");
  }
  return {
    ...base,
    activated: result.activated.sort(),
    alreadyUsable: result.unchanged.sort(),
    wouldActivate: [],
    pass: result.missing.length === 0,
  };
}

module.exports = { activateSampleCompanyCredentials, sampleCompanyCredentialAllowlist, supersededExclusions, CredentialActivationError };
