# Sales — Trusted Opportunity Read Projection (Cycle 3c)

Status: **BUILT (repo-only, fail-closed, undeployed/ungranted).** The governed read authority for the
Opportunity workspace — a **trusted minimal read projection**, chosen deliberately **instead of widening
client-direct read Rules**.

## Why a trusted projection (not a client Rules widen)
Owner-ratified direction: the client does **not** receive broad direct-collection read authority merely for
UI convenience. The `opportunities` collection stays **Admin-SDK-only** (Rules deny-all, unchanged — **no
hash re-pin, no Rules deploy**). A trusted backend resolves the caller's governed scope, reads canonical
records, and returns only the minimal projection the Sales workspace needs.

## Read contract
`listOpportunityContext` (onCall): auth required; authorization = capability **`opportunity.read`**
(registered `active:false` → fail-closed for everyone until a separate Owner grant); caller identity from
`request.auth.uid` (never a client-supplied employee id); Admin-SDK read; returns the projection.

**Projection principles enforced** (`opportunityReadService.ts`, pure `projectOpportunity` / `summarizeReadResult`):
- Minimal fields only: `id, accountId, salesChannel, ownerEmployeeId, stage, outcome, need, expectedValue,
  expectedCloseAt, nextAction, lines`.
- **No raw Firebase UID** as business identity; **no Customer PII copied** into the Opportunity (returns
  `accountId`; names resolve separately from the canonical Account authority).
- Invalid stage/outcome/qty and malformed lines are **dropped**, not trusted.
- No invented forecast/pricing authority.
- **Four honest states the UI must tell apart:** `denied` (permission-denied), `empty` (ready + []),
  `unavailable` (read failure → internal), `degraded` (some docs unprojectable → surfaced with a skip count).

## Client seam (no frontend rewrite)
`access/opportunitySource.js` gains a **pure** `mapOpportunityReadResult({ok,payload,errorCode})` that maps the
callable's outcome to the existing source-snapshot shape (ready/degraded/denied/unavailable; `accountNameById`
intentionally empty — names come from the Account authority). The governed source (a thin wrapper that calls
`listOpportunityContext` and returns this mapping) replaces the synthetic **default** at activation; the
default stays synthetic today because the callable is undeployed and the capability ungranted.

## Files
`functions/src/opportunity/opportunityReadService.ts` · `functions/src/index.ts` (export) · permissionCatalog
(both mirrors) `opportunity.read` active:false · resolver A3 allowlist · `field-ops` `access/opportunitySource.js`
mapping · tests `opportunityReadService` (4) + `opportunityReadMapping` (4) · CI extended.

## Protected activation (still Owner/operator-gated — NOT done here)
`opportunity.read` grant · `listOpportunityContext` deploy · production activation. **No Rules widening** was
required or performed; if a future business requirement proves a trusted projection cannot satisfy it, return
with evidence and options rather than widening client Rules preemptively.
