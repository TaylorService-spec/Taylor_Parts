# INV-CONVERGENCE-E C2 Hosting deployment evidence

**Date:** 2026-07-27
**Project:** `taylor-parts`
**Authorized commit:** `081df750d89d9044f0e09bb0241796b8171ed33f`
**Deployment scope:** Firebase Hosting only
**Result:** DEPLOYED AND VERIFIED — GREEN

## Governed result

- Fresh live parity: PASS (`190` valid canonical Parts, `0` invalid, `10`
  approved static-only exclusions, `200` detail-ready, zero divergences).
- Hosting advanced from pinned rollback version `0bd9029d010914b7` to
  `1ef5d23b1c0b9466`.
- Live asset `/assets/index-Bpj7e20-.js` exactly matched the authorized build
  manifest (SHA-256 `756693f2779e34a5fefb03d1c4450d32e39aa6d2c1c6154a06cfda553eb11ff5`).
- Firestore Rules remained byte-identical pre/post
  (`cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`).
- Normalized Functions remained byte-identical pre/post
  (`011020f83d188ff578ed1fdeba40d48f2075be929ab0b28e3975221363820fab`).
- Admin, Dispatcher, PARTS_MANAGER, and WAREHOUSE_MANAGER each received
  canonical `200/190`, rendered `EACH` and `KIT`, and resolved approved
  static-only route `TST-1047`.
- Technician received canonical `403/0`, was denied the Inventory route, and
  saw neither static-as-success nor a PartDetail write surface.

No browser control was activated. No Firestore write, Auth/identity/role/claim/
session mutation, Rules/Functions/index/config deployment, or Parts migration
occurred.

## Evidence integrity

`SHA256SUMS.txt` covers every evidence file except itself. The governed sensitive
scanner passed. The downloaded sanitized archive matched the Cloud Shell hash:

`fa3764768e7476250127b0ee5c485da97a4e6360567214f43b3da4d25376d954`

The archive is not committed; these checksum-pinned files are the repository
evidence.
