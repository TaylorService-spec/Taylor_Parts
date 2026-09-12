# W1-C26 — client financial surfaces: registrations required

Lane C26 (`impl/w1-financial-surfaces`) discloses operating-company attribution on the client
financial surfaces. This file records the test-registration decision and the one CI path filter a
shared-file owner should add.

## The suites.json decision: NO new suite file

`field-ops-app-vite/test/ciSuiteCoverage.test.mjs` requires every new client test file to be
registered in `field-ops-app-vite/test/suites.json` or named by a workflow. `suites.json` is a
shared file this lane may not edit, so **no new suite file was created**. Every assertion was added
to a suite that already runs in CI:

| Suite | Already registered by | What C26 added |
| --- | --- | --- |
| `field-ops-app-vite/test/accountArView.test.mjs` | `suites.json` (`node`) — run by `npm test`, which `client-suite-manifest-tests.yml` invokes on any `field-ops-app-vite/**` change | 4 cases: the view model's company dimension, the absent-dimension fallback, the single-company no-noise case, and that the server's span flag is read rather than recomputed |
| `field-ops-app-vite/test/financialFactsView.test.mjs` | `suites.json` (`node --test`) **and** `financials-north-star-tests.yml` | 8 cases: `companyAttribution` / `companyAttributionLabel` / `agingCompanySpan` contracts, plus source-level contracts for the three surfaces |
| `field-ops-app-vite/test/accountHealthStrip.test.mjs` | `account-workspace-tests.yml` (path filter includes `src/domain/accountHealthStrip.js`, which C26 changes) | 4 cases: the Outstanding AR tile label under blended / single-company / company-blind reads |

`ciSuiteCoverage.test.mjs` passes unchanged (5/5), and its `KNOWN_UNNAMED` allowlist was not
touched — nothing was added to it.

## Registration a shared-file owner should add

`field-ops-app-vite/src/domain/companyAttribution.js` is new and appears in **no workflow path
filter**. It is covered today only because `client-suite-manifest-tests.yml` runs the whole
`suites.json` manifest on any change under `field-ops-app-vite/**`, so its tests do run — but a
change to that file alone will not report as a *Financials* failure, which is the point of the
family lane.

Requested (workflows are a shared file this lane may not edit):

```yaml
# .github/workflows/financials-north-star-tests.yml — both the pull_request and push path lists
      - "field-ops-app-vite/src/domain/companyAttribution.js"
```

Optionally the same path in `.github/workflows/account-workspace-tests.yml`, since
`AccountArSection.jsx` and `accountHealthStrip.js` both consume the module.

No `suites.json` entry is required.

## Dependency

Full behaviour depends on **PR #1882 (lane C17, `impl/w1-financial-authority`)**, which adds the
server facts this client consumes: `summary.byCompany`, `summary.companyIds`,
`summary.spansMultipleCompanies`, `agingByCompany`, and a per-row `companyId`. C26 does **not**
cherry-pick it. Before #1882 merges, every surface renders exactly as it does today and asserts no
breakdown; after it merges, the disclosures activate on their own.
