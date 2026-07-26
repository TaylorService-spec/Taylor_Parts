# Stage B Production Verification

## Deployment

- Project: `taylor-parts`
- Authorized commit: `804351831d2d5a90c97481a57373a5960e42ab75`
- Governed Firestore Rules SHA-256: `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`
- Deployment scope: `firestore:rules` only
- Live extracted Rules source matched the governed Git source.
- No Cloud Functions deployment activity occurred.

## Direct production matrix

| Persona | Parts list | Parts single | Adjacent reads | Parts writes |
|---|---:|---:|---:|---:|
| Admin | 200 | 404 | 403 | 403 |
| Dispatcher | 200 | 404 | 403 | 403 |
| PARTS_MANAGER | 200 | 404 | 403 | 403 |
| WAREHOUSE_MANAGER | 200 | 404 | 403 | 403 |
| Technician | 403 | 403 | 403 | 403 |

A `404` single-document response means Rules allowed the read and the probe document did not exist.

Adjacent collections exercised:

- `manufacturers`
- `part_aliases`
- `part_supplier_items`

Denied write methods exercised:

- create
- update
- delete

## Credential remediation

The dedicated admin test account password was reset because the prior password was unavailable.

The following were not changed:

- UID
- email
- enabled status
- security roles
- operational roles
- custom claims
- Firestore application data

## Outcome

- Required positive reads: PASS
- Required negative reads: PASS
- Required negative writes: PASS
- Unauthorized Firestore mutations: NONE
- Rules defect established: NO
- Rollback required: NO
- Stage B production verification: PASS

C1 and C2 remain blocked until this evidence is reviewed and merged through the governed repository workflow.
