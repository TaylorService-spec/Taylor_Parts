# Sandbox blocker — 16 Cloud Functions are unreachable from the browser

Found 2026-08-16 during the #1041 E2E matrix, against live `eos-platform-sandbox` at Hosting commit `b2193fd0`.

## Symptom

The browser reports a CORS failure:

```
Access to fetch at '.../listOpportunityContext' from origin 'https://eos-platform-sandbox.web.app'
has been blocked by CORS policy: Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Cause — NOT CORS, and not a code defect

The CORS message is a symptom. Google Frontend rejects the request with **403 Forbidden** before the function
ever runs, and a 403 error page carries no CORS headers, so the browser can only report it as CORS.

The underlying Cloud Run service has **no IAM bindings at all**:

```
$ gcloud run services get-iam-policy listopportunitycontext --region=us-central1
{ "etag": "ACAB" }                      # <- no bindings

$ gcloud run services get-iam-policy listopportunitiesforaccount --region=us-central1
bindings: [{ members: [allUsers], role: roles/run.invoker }]   # <- working function
```

Confirmed end to end: the broken function returns 403 on OPTIONS preflight; a working one returns 204 on
preflight and 401 with a correct `access-control-allow-origin` header on an unauthenticated POST.

The function code is identical in shape -- both are `onCall({ region: "us-central1" })`, which handles CORS
automatically. Nothing in the repository can fix this.

## Why `allUsers` is the correct binding here

It grants network reachability, not application access. A Firebase callable enforces authorization *inside*
the function (`request.auth` plus `resolveEffectiveAccess`), which is exactly why a reachable function still
answers **401** to an unauthenticated caller. This is the standard posture for Firebase callables and is what
the 66 working functions already have; it is not a weakening of the governed access model.

## Impact

16 of 82 live functions are unreachable from any browser, so the surfaces that depend on them render empty
shells regardless of capability activation or Role grants. This is upstream of authorization entirely.

| Function | Surface blocked |
|---|---|
| listOpportunityContext | Opportunity pipeline + detail (**the likely true cause of the reported "missing stage chevrons"** -- with no data there is no pipeline and no detail panel) |
| getSalesOrderContext, transitionSalesOrder, createSalesOrderFromOpportunity | Sales Order flow |
| createPart, createPartSupplierItem, changePartSupplierItemStatus, setPreferredSupplier | Part Master / supplier write |
| setWorkOrderPartsPlan | WO Parts Planning |
| applyPayment, listAccountInvoiceAr | Finance / AR |
| getInventoryAnalytics, detectInventoryEffects | Inventory analytics + effects |
| createCoverageAssignment, createSalesTerritory, resolveCoverageForContext | Coverage / territory |

## Remedy (operator — IAM change, outside agent authority)

Run per function, or simply redeploy each one (a deploy sets the binding, which is how the 66 healthy
functions got theirs):

```bash
gcloud run services add-iam-policy-binding applypayment --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding changepartsupplieritemstatus --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding createcoverageassignment --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding createpart --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding createpartsupplieritem --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding createsalesorderfromopportunity --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding createsalesterritory --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding detectinventoryeffects --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding getinventoryanalytics --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding getsalesordercontext --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding listaccountinvoicear --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding listopportunitycontext --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding resolvecoverageforcontext --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding setpreferredsupplier --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding setworkorderpartsplan --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
gcloud run services add-iam-policy-binding transitionsalesorder --region=us-central1 --project=eos-platform-sandbox --member=allUsers --role=roles/run.invoker
```

## Verify

```bash
# expect 204, not 403
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS \
  -H 'Origin: https://eos-platform-sandbox.web.app' -H 'Access-Control-Request-Method: POST' \
  https://us-central1-eos-platform-sandbox.cloudfunctions.net/listOpportunityContext
```
