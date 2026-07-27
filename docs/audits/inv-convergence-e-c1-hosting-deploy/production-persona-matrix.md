# C1 production persona read verification (sanitized)

Governed test personas from the Windows DPAPI-encrypted local vault; credentials never
exposed. Read-only against the live site; **no write probes used, no Firestore mutation**.

| Persona | Canonical parts read | Result |
|---|---|---|
| Admin | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| Dispatcher | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| PARTS_MANAGER | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| WAREHOUSE_MANAGER | HTTP 200, 190 canonical Parts | PASS (ALLOW) |
| Technician | HTTP 403, zero Parts | PASS (fail-closed) |

## C1 composition (governed, non-browser)
- Governed composition tests: **23/23 PASS**.
- 190 canonical Parts + 10 approved STATIC_ONLY_EXCLUDED = **200 catalog records**.
- Stable SKU/partId routing remains governed → unchanged PartDetail.
- Live asset is byte-equal to the authorized C1 build (see deployment-result.md).

Only persona labels / HTTP status codes / counts are recorded — no UIDs, personal
addresses, credentials, or raw production records.
