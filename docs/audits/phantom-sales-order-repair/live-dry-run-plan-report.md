# Phantom Sales Order Link Repair -- dry-run plan

- Generated: 2026-08-19T03:51:19.171Z
- Project: eos-platform-sandbox
- Repository commit: a3237da90b58e606edeef5cf167fc8254234cfe4
- Phantom Sales Order id under repair: so-harbor-c713
- Repair package id: a3237da90b58e606edeef5cf167fc8254234cfe4
- Reason (written to every repaired record): Sales Order so-harbor-c713 does not exist; link is unresolvable

- Bind this to --plan-sha256 at execute (sha256 of plan.json bytes): 584706e705c182d3b6045c15fa883f8ac786cdec975baf6cdaf332aec8e1f032
- Operative plan hash (stable across reruns when data is unchanged; NOT the --plan-sha256 value): a96b0343bc667babf86c23f67c6731a5afb2a5af0bb834db62d5d2f922547154

| considered | needs repair | already repaired | not this phantom id |
|---|---|---|---|
| 5 | 5 | 0 | 0 |

Review `assignments` in plan.json -- each entry names the exact `workOrderId`, its `statusBefore`, its full `inventorySnapshotBefore`, and the exact proposed field changes -- before authorizing execute.
