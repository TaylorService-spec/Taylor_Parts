# C1 production persona verification (sanitized) — provenance-accurate

**What this check actually was (not a browser-rendered PartsList test):** governed test
personas from the Windows DPAPI-encrypted local vault were authenticated through
**Identity Toolkit** (credentials never exposed), then used to perform **read-only live
Firestore REST reads of the canonical `parts` collection**. **No write probes; no
Firestore mutation.** This exercises the deployed **Rules authorization** for canonical
`parts`, per persona — it does **not** render the site or PartsList in a browser.

| Persona | Canonical `parts` REST read | Result |
|---|---|---|
| Admin | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| Dispatcher | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| PARTS_MANAGER | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| WAREHOUSE_MANAGER | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| Technician | HTTP 403, zero Parts | PASS (fail-closed) |

## Combined-evidence conclusion (accurate scope)
Live C1 behavior is supported by the **combination** of:
1. the **live deployed bundle exactly matches the authorized C1 build** (byte-equal
   asset SHA-256 vs the Cloud Shell build manifest — see `deployment-result.md`);
2. the **governed C1 composition tests passed 23/23** (190 canonical + 10 approved
   STATIC_ONLY_EXCLUDED = 200 records; stable SKU/partId routing → unchanged PartDetail);
3. the **live persona canonical reads returned the expected 200/403 results** above.

**Therefore live C1 behavior is supported by this combined evidence — but the rendered
PartsList was NOT directly browser-observed for every persona.** This is an inference
from (1)+(2)+(3), not direct browser evidence of the rendered catalog per persona.

Only persona labels / HTTP status codes / counts are recorded — no UIDs, personal
addresses, credentials, or raw production records.
