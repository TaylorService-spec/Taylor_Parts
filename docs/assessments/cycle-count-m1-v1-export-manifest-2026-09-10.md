---
artifact_type: evidence-manifest
title: M-1 — Cycle Count v1 export and sandbox closeout
date: 2026-09-10
authority: Owner ruling M-1 = Option A (2026-09-10); Certification frozen
tool: functions/scripts/exportCycleCountV1.mjs (exportCycleCountV1/1), scripts/m1CloseoutSandboxCycleCountV1.mjs
---

# M-1 — Cycle Count v1 export and sandbox closeout

## Result

| | eos-platform-sandbox | eos-platform-certification |
|---|---|---|
| v1 `cycle_counts` (re-measured 2026-09-10) | **24** — 1 OPEN, 21 COUNTED, 2 RECONCILED | **1** — RECONCILED |
| Subcollections | none | none |
| Export body sha256 | `f0cf91ebcb184aee915819eb8bb56bacb6405724751fb15d9e9d9ff972e7f34a` | `ce1a5fab06083b196e0038729cf67decb0a487b1a2c43f9dce06ab7880311b6f` |
| Exported at | 2026-09-10T11:02:29.589Z | 2026-09-10T11:02:32.385Z |
| Hash verification | every per-document hash reproduced by two independent re-reads, and recomputed from the stored data | same |
| Mutation | **none** (see closeout) | **none — frozen; export/read only** |
| Deletion | none | never |

**Export files** (complete stored documents in canonical form — sorted keys, Timestamps as `{seconds,nanos}` —
each with its own sha256; plus source project, collection, export time, operator, tool version, body hash):
`D:\Taylor_Parts-evidence\m1-cycle-count-v1-2026-09-10\eos-platform-sandbox.cycle_counts.v1.json` and
`…\eos-platform-certification.cycle_counts.v1.json`, on the operator workstation, outside every git checkout.
They are deliberately not committed: full operational records do not belong in the repository
(`scripts/operationalPayloadGuard.mjs`). No credential or token is in either file or in this manifest.
Operator: the workstation's gcloud account (Application Default Credentials).

## Closeout — why no sandbox record was mutated

The ruling allows closing an OPEN/COUNTED v1 count through the **current governed v1 command** where that can
be done without fabricating anything.

- **OPEN (1).** `cancelCycleCount` asserts nothing about stock, and the closeout tool ran it signed in as the
  same persona that opened the count (`partsAssociate`, uid verified from the ID token). The deployed command
  **refused it** (`failed-precondition`). Cause: all 24 sandbox records carry `operatingCompanyId`, written by
  the Owner-authorized sandbox ownership backfill of 2026-08-30 (`ownershipBackfillRules.ts`: `cycle_counts`,
  24 documents). The v1 deserializer rejects any field outside its key set, so **no v1 command can operate on
  any of the 24 records**. Removing the field to make the cancel succeed would be rewriting history, so it was
  not done. A re-export after the attempt reproduced every hash: nothing changed.
- **COUNTED (21).** Disposing of them would need a reconciliation decision nobody made. Not touched.
- **RECONCILED (2 sandbox, 1 certification).** Already terminal.

So retirement applies to all 24: they stay as **inert v1 history**. The v2 authority does not read them — its
operational population is `schemaVersion == 2` only, selected by query, never deserialized from a v1 record.
Coexistence in the same collection needs no deletion, so none was performed.

**Finding for the v2 shape.** The Ownership Model (`ownershipMatrix.ts`) governs `cycle_counts` with an owner
field `operatingCompanyId`, inherited from the counted location's company and IMMUTABLE. v1 never learned it,
which is why the backfill made every v1 record unreadable. The v2 sheet carries `operatingCompanyId` from
creation, derived from the counted location's governed Warehouse.

## Documents

### eos-platform-sandbox — 24 document(s)

| Document id | Status | Location | sha256 (canonical document) |
|---|---|---|---|
| `cyc_0b46176fb16d3d1f28338a5ff9589b8fe4e1bb33` | COUNTED | WAREHOUSE:wh-main | `7a355f20a901b5283fa9ca2663cb1bd94daf82ee343a23c99f17e2027be9e03d` |
| `cyc_16dd0e4f86136c29fe40ae3cdeb4d32060cb79f6` | COUNTED | WAREHOUSE:wh-main | `226accc1852aeaba67eb1c8c57a0e6267a6f2d49aa7b385dc6d70722c457f19b` |
| `cyc_249ea855ad3f5b8f558b0c0271fa66e6482cca1f` | RECONCILED | WAREHOUSE:wh-north | `280e036b690951908e9d9942d12d38a6b1c432cec49210da5f033987872cf2ec` |
| `cyc_350cc17b1614cb966f44401ea30e0415e5bbf38b` | COUNTED | WAREHOUSE:wh-main | `c5c9c9c90a6536d065f38dc94e994f2cac8927f673125879d49d045082161faf` |
| `cyc_3ae7e6a4ae1ad9d1ed4361815fb420e6e0c0aedd` | COUNTED | WAREHOUSE:wh-main | `e86bf326607967208183030885c54a8770ef2e97711e9d44b4c296bd3edfd490` |
| `cyc_414725677fe2f60b1a2a1a2291cedaebf6ff6031` | COUNTED | WAREHOUSE:wh-main | `fa7bf157d9979ee577e5cadde74b0db115ea4a4a05077bc6f0b5ec0fa568a869` |
| `cyc_5cf2626f6208f0af94acb6e21c04b7a4bbc4b6d2` | COUNTED | WAREHOUSE:wh-main | `c6101309d9254d0fd5c846b02508c5717080ff24442cc0507f0698071bc58529` |
| `cyc_6149cc03802a347f95efe21096a6e2ffaae366ec` | COUNTED | WAREHOUSE:wh-main | `d8b579d1b38f6eb54afc45ebffa36abc179874b5aebb506b722ddfc0306be61b` |
| `cyc_65264bdd52523e3e14d3240c00a368afb968af48` | COUNTED | WAREHOUSE:wh-main | `982e550535b8d7d3a8f4ad8dbe729e3ed7782bcc5472d9f1056be81a2135ee4a` |
| `cyc_6babd9c9742e8713973983de9cfe6dadbd03692e` | COUNTED | WAREHOUSE:wh-main | `652d9fa13a4b1576a487d6a493c44db1ad1b28cfb87bc6a3dc8119a9b3a3aab0` |
| `cyc_6d85580dc6cff94eb85bce9d136f0b4787eef136` | COUNTED | WAREHOUSE:wh-main | `4d989949084d6a78e731b126b0f792f68d5813b049ae9ff07c0241701314438b` |
| `cyc_6ef5e8c8e29b6ce2c4b6ff7f14556dab7fc183ac` | COUNTED | WAREHOUSE:wh-main | `00cd149cb6e60206f2d70d710235e89f3ac9b0213fe76822e94a375a711f4654` |
| `cyc_73a78458124cd1072bd8b244758c8feabd98f919` | OPEN | WAREHOUSE:wh-main | `b372329b71eba115ccef24fa4cf24f31f7abe6e644a2b977d1d5fc9e5c698838` |
| `cyc_779b65322f6232e255efaaf9a8c517cde687eb5b` | COUNTED | WAREHOUSE:wh-main | `2ae8217d5cd5af8e77f6ff4b4cf20c64fe8217bdb06b98b24e3902c547c5d2b5` |
| `cyc_7f8d9e587cc7527e908f37e0b58127433fdcc0cb` | COUNTED | WAREHOUSE:wh-main | `a794b064bc998cbb5280fc83da853d3544d9629d58103a3c3c3eae7699e27b52` |
| `cyc_a19f96e183f8f4a348460ac8f4e69dad18bbc920` | COUNTED | WAREHOUSE:wh-main | `8ca295e13f4d846770c679401efd5d661ec657f423c2ed242147e781ac27aabd` |
| `cyc_a48f809a9c3486fb96477e14ac3063cb1d4df561` | COUNTED | WAREHOUSE:wh-main | `48d84d3259f98d0546fc85faed8f6d418239aaf8d10ace9ce4bdb0703c445e13` |
| `cyc_b2fa719bcd9b8839437ae66b86bb9f28972020ce` | COUNTED | WAREHOUSE:wh-main | `4346a3cbd8a0a1622c9855da81902437f49d3fb36f504e8cdee30a7c62db6699` |
| `cyc_c5cf01329b986ccaeed34cab25441d6a8fabb382` | COUNTED | WAREHOUSE:wh-main | `68efb6c5f181ba3c2c4d7492bd92eec7826c57e6a30999a7b3ac1e55dfbf0569` |
| `cyc_c96c31c8972dba73ee8c79c1be0cfd9f5972f339` | COUNTED | WAREHOUSE:wh-main | `17635dada2a42987c9a52271020d2318f14298b6495e65e90b5868224d40dd16` |
| `cyc_cb1b7e6bdec0cfdf8b245a202784dc2c90de5647` | RECONCILED | WAREHOUSE:wh-main | `1086685ced03e262fd11ffedbc8766cbb44f8d7995d392935185dd2b7827b0b2` |
| `cyc_f04ac52462aa8cabeca97c19273b6f70b0760756` | COUNTED | WAREHOUSE:wh-main | `f8d83cdd2cbb05ee2f50086f000a4aa56da61389cbacf803efc69938690d0925` |
| `cyc_f28f2d5dd6b16bd7143164ab17a104b50cce48b6` | COUNTED | WAREHOUSE:wh-main | `3e9310d0d0a249f2c2cb5dd3f47b3d5ef38ea840e365f32e02915c022890d120` |
| `cyc_f5bc5169ef6892c8a8f32fd354c7dd6b7ba63f5a` | COUNTED | WAREHOUSE:wh-main | `e234b4c8ae5157f5f564eab8a32b94c2186b53f37d1edbc19d2eb5542b1f5f27` |

### eos-platform-certification — 1 document(s)

| Document id | Status | Location | sha256 (canonical document) |
|---|---|---|---|
| `cyc_d475d391eac69831d67e6d097bd91e09ff089ddc` | RECONCILED | WAREHOUSE:wh-main | `edc34e0234a326613fb8585d08e765cb620d910ad453484e3502aefd2ea44748` |
