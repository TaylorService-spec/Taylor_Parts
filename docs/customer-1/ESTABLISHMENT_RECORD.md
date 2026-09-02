# Customer 1 Ledger — Establishment Record

**Date:** 2026-09-02  
**Base main:** `1667cd5e16e46e59223b200fcd882fe7d1925a1e`

## Established

- durable Customer 1 readiness authority under `docs/customer-1/`;
- human executive view plus machine-readable JSON gate state;
- fail-closed automation/status-transition rules;
- permanent EOS deployment training-close rule under `docs/training/`;
- reusable role/workflow user-guide template;
- CI cost rule prohibiting Windows-hosted Actions for ledger automation;
- Pages path filter so documentation-only main pushes do not rebuild/deploy the frontend.

## Initial decision

`CONTINUE_TOWARD_CUSTOMER_1_NOT_AUTHORIZED_FOR_PRODUCTION_DEPENDENCY`

No gate was marked `READY` merely because prior product work exists. Existing product/security work is represented as `IN_PROGRESS` until the Customer 1-specific close condition is satisfied.

## Pages cost correction

Before this change, `.github/workflows/deploy-field-ops.yml` ran on every push to `main`, including documentation-only changes.

The workflow remains Linux-only (`ubuntu-latest`) and remains automatic for changes capable of changing the published Pages site. Its trigger is narrowed to:

- `index.html`
- `field-ops-app-vite/**`
- `.github/workflows/deploy-field-ops.yml`

Therefore routine `docs/customer-1/**` and `docs/training/**` updates do not spend a Pages build/deploy after this change is merged.

`docs/Deployment.md` contains an older statement that Pages runs on every main push. That document already represents a historical 2026-08-06 truth pass and must be reconciled in its next deployment-authority truth refresh; this record is the dated evidence for the trigger change and does not silently rewrite the historical observation.

## Training close correction

From this record forward, `DEPLOYED` is not equivalent to `CLOSED` for a user-impacting release.

Closure requires either:

- `TRAINING: COMPLETE`, or
- `TRAINING: NOT REQUIRED — VERIFIED NO USER IMPACT`.

The authoritative training rule is `docs/training/README.md`.
