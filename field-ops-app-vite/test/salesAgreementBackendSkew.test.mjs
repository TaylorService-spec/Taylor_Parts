// THE CLIENT TOLERATES A BACKEND THAT IS NOT DEPLOYED YET.
// Run: node --test test/salesAgreementBackendSkew.test.mjs
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// Hosting ships from current main while the Sales Agreement Functions are deliberately held for a
// controlled all-or-nothing release. So the deployed client called a callable the deployed backend
// does not have — on EVERY Opportunity a user selected.
//
// An undeployed Firebase callable answers 404 WITHOUT CORS headers, so the browser does not report
// "not found". It reports:
//
//   Access to fetch at '…/getSalesAgreementForOpportunity' has been blocked by CORS policy:
//   Response to preflight request doesn't pass access control check
//
// Observed live in platform-sandbox at afc5f826, on every selection, for every persona.
//
// That console noise is not cosmetic. It is the first thing anyone reads when something else goes
// wrong, and it describes a feature that is merely undeployed as a security-policy failure.
//
// ════════════════════ THREE FACTS, THREE STATES ════════════════════
//
//   NOT_ENABLED   the backend is not live here, so nothing was asked
//   DENIED        we asked, and this caller may not
//   UNAVAILABLE   we asked, and could not reach it
//
// Collapsing the first into the second tells somebody to request access that would not help them;
// collapsing it into the third tells them to retry something that will never succeed.

import test from "node:test";
import assert from "node:assert/strict";
import { salesAgreementView, SALES_AGREEMENT_VIEW_STATE as STATE } from "../src/domain/salesAgreementView.js";

test("NOT_ENABLED IS ITS OWN STATE, distinct from denied and from unavailable", () => {
  assert.equal(salesAgreementView({ result: null, loading: false, errorStatus: "not-enabled" }).kind, STATE.NOT_ENABLED);
  assert.equal(salesAgreementView({ result: null, loading: false, errorStatus: "permission-denied" }).kind, STATE.DENIED);
  assert.equal(salesAgreementView({ result: null, loading: false, errorStatus: "internal" }).kind, STATE.UNAVAILABLE);
  assert.equal(salesAgreementView({ result: null, loading: false, errorStatus: "not-found" }).kind, STATE.UNAVAILABLE);
  // Four distinct kinds, so no two of them can render the same sentence by accident.
  assert.equal(new Set([STATE.NOT_ENABLED, STATE.DENIED, STATE.UNAVAILABLE, STATE.NONE]).size, 4);
});

test("NOT_ENABLED outranks a stale result — a disabled feature shows no data", () => {
  // The capability can flip off between renders (a revoked grant, an environment change). Whatever
  // was already fetched must stop being shown, not linger as though the feature were live.
  const stale = { status: "ready", salesAgreement: { id: "agr-1", salesAgreementNumber: "SA-2026-000001", lines: [] } };
  assert.equal(salesAgreementView({ result: stale, loading: false, errorStatus: "not-enabled" }).kind, STATE.NOT_ENABLED);
});

test("LOADING still wins, so a disabled read never flashes an error first", () => {
  assert.equal(salesAgreementView({ result: null, loading: true, errorStatus: "not-enabled" }).kind, STATE.LOADING);
});

test("THE HOOK ASKS FOR NOTHING WHEN THE CAPABILITY IS ABSENT", async () => {
  // The behavioural half: not merely "the state is right" but "no request was made". This is what
  // actually removes the CORS error from the console.
  const { useSalesAgreement } = await import("../src/hooks/useSalesAgreement.js");
  const src = (await import("node:fs")).readFileSync(
    new URL("../src/hooks/useSalesAgreement.js", import.meta.url), "utf8",
  );
  assert.equal(typeof useSalesAgreement, "function");
  // The guard must precede the read, and must precede the opportunityId check — a caller without
  // the capability is answered before anything else is considered.
  const enabledGuard = src.indexOf("if (!enabled)");
  const idGuard = src.indexOf("if (!opportunityId)");
  const theRead = src.indexOf("await getSalesAgreementForOpportunity(");
  assert.ok(enabledGuard > 0, "the hook must refuse to read when not enabled");
  assert.ok(enabledGuard < idGuard, "the capability answer comes first");
  assert.ok(enabledGuard < theRead, "and it comes before the request");
  assert.match(src, /\}, \[opportunityId, enabled\]\);/, "the read re-runs when the capability flips");
});

test("THE WORKSPACE GATES THE READ ON THE READ CAPABILITY, and defaults closed", async () => {
  const fs = await import("node:fs");
  const ws = fs.readFileSync(new URL("../src/modules/sales/SalesWorkspace.jsx", import.meta.url), "utf8");
  assert.match(ws, /enabled: hasCapability\?\.\(SALES_AGREEMENT_READ_CAPABILITY\) === true/);
  // `hasCapability` defaults to () => false, so every caller that injects nothing — every test, and
  // any surface that forgets — reads nothing rather than firing a doomed request.
  assert.match(ws, /hasCapability = \(\) => false/);
});

test("the panel says NOT DEPLOYED rather than NOT PERMITTED", async () => {
  const fs = await import("node:fs");
  const panel = fs.readFileSync(new URL("../src/modules/sales/SalesAgreementPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /STATE\.NOT_ENABLED/);
  assert.match(panel, /not enabled in this environment yet/i);
  // And it must not reuse the permission sentence for it: that would send somebody to an
  // administrator for access that would not help.
  const notEnabledBlock = panel.slice(panel.indexOf("STATE.NOT_ENABLED"), panel.indexOf("STATE.DENIED"));
  assert.doesNotMatch(notEnabledBlock, /permission/i);
});
