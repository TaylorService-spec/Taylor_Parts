# Recovery manifest — recovered historical design evidence

- **Lane:** ARCH-RECOVER. **Mode:** EVIDENCE_WRITE — no runtime code, test, config or schema changed.
- **Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (`ATLAS-BASE-2026-09-12-A`).
- **Recovery date:** 2026-09-13.
- **Branch:** `archaeology/recovered-design-evidence`.

---

## 0. Classification — applies to every file listed in this manifest

> **RECOVERED HISTORICAL DESIGN EVIDENCE**
>
> **NOT:** current North Star · current implementation authority · permission to redesign · **proof that current EOS still conforms.**

These artifacts are **historical evidence of what was designed and what an Owner accepted at a past date.**
They are filed under `docs/design-history/recovered/` and deliberately **not** under `docs/north-star/`,
because placing them there would assert an authority status no one has granted them. Recovering an
artifact restores the ability to *audit* a historical acceptance. It does not re-open that acceptance,
it does not make the artifact a current target, and **it is not evidence that today's EOS matches it.**
Whether any recovered artifact becomes current authority is an Owner decision this lane did not make
and must not be read as having made.

### 0.1 The four statuses this manifest keeps separate

| Status | What it describes | Where it is recorded |
|---|---|---|
| **ORIGINAL ARTIFACT** | The file as delivered, inside a `.zip` in local custody outside git. Identified by archive SHA-256 + original absolute path + member path. | §2, §3 |
| **RECOVERED COPY** | The byte-identical copy committed here, at `docs/design-history/recovered/…`. Verified by SHA-256 against the pre-existing census and re-verified after write. | §3 |
| **HISTORICAL ACCEPTANCE STATUS** | What an Owner accepted, when, and against which named artifact — as recorded at baseline. A statement about the past. | §3 per package, §5 |
| **CURRENT AUTHORITY STATUS** | What governs implementation **today**. For every artifact in this manifest this is: **NONE — not current authority.** | this section; §6 |

**CURRENT AUTHORITY STATUS of every file in this manifest: NONE.** No row below changes any
current North Star, Atlas input, or implementation target. Recovery of a historical acceptance
authority does **not** establish that the shipped surface still conforms to it; nobody has run that
comparison, and this lane did not.

---

## 1. What was searched, and what the numbers are

Source: **22 `.zip` archives** in local custody at `/mnt/d/Taylor_Parts/Claude Design Docs/`, read-only to this lane.

| Measure | Value |
|---|---|
| Archives | 22 |
| Archive bytes | 9,884,937 |
| Contained files (entries) | 184 |
| Contained bytes (uncompressed) | 11,480,254 |
| Entries whose **content** (SHA-256) is already in the repo | 123 (7,144,093 B) |
| Entries whose content is **absent** from the repo → recovered here | 61 (4,336,161 B) |
| Distinct blobs recovered (entries deduplicated by SHA-256) | 57 (4,263,393 B) |
| Packages with at least one recovered file | 17, across 12 families |
| SHA-256 verification defects | **0** |

**Comparison method, and why it matters.** Presence was decided by **SHA-256 over every one of the
4,519 files tracked at baseline**, not by filename. Filename matching is wrong in both directions here:
it reports package `README.md` files as "present" because the repo has 44 `README.md` files of its own,
and it reports already-vendored canvases as "new" because the repo renamed them on vendoring
(`North Star - Lists P1.dc.html` → `Lists-North-Star-P1.dc.html`). See §4 for the corrections this
produced to the inherited census figures.

---

## 2. Archives — original custody, SHA-256, and what each yielded

The `.zip` files are **not** committed. Each is identified below by SHA-256 and original absolute path,
which is what makes the recovered copies auditable against their source. See §6.2 for why.

| Archive (ORIGINAL ARTIFACT) | Bytes | Archive SHA-256 | Entries | Recovered | Already in repo |
|---|---|---|---|---|---|
| `Customer North Star P1v1.zip` | 10,680 | `b959f42ab2a644d2e43f0b680051d760bbb882c76e011fb3c44cd1a6db49123b` | 2 | **2** | 0 |
| `Dispatch and Schedule North Star P1v1.zip` | 9,636 | `3d3dda12a65cde168973ea25f4612cb51cf6facf9f38aa626538fb74cf2dd0be` | 2 | **0** | 2 |
| `Equipment North Star P1v1.zip` | 9,726 | `65d6f595a03833a51311577efaea45abf8735875f93592bfa50643399b4dc7b9` | 2 | **1** | 1 |
| `Equipment North Star P1v2.zip` | 19,309 | `2837a10b385815b994e24e409c8d4eef6c3149449e2be7d71f87c87b85a6644f` | 3 | **2** | 1 |
| `Equipment North Star P1v3.zip` | 19,874 | `de1303909cdadfc6dde05d9aeb32e58128a5b685946093d0f3c79a6c275f71a6` | 3 | **0** | 3 |
| `Financials North Star P1v1.zip` | 5,737,337 | `30fabe0e5fe55fcda01c89d229c6686ccbd32aec3e506866e466793a4ab097fb` | 95 | **2** | 93 |
| `Lists and States North Star P1v1.zip` | 10,730 | `baaa45fb6130034d786bac0fbf4b4a215c1202b9736b04b053577292dd352989` | 2 | **1** | 1 |
| `Lists and States North Star P2v1.zip` | 24,459 | `338e961da3346d4ba1377f575cd85eef3bc8ff10c7020422ef6ccbfd8f8a0b1f` | 3 | **0** | 3 |
| `Opportunity North Star P1v1.zip` | 10,018 | `7da93372fd81dc53c9b83fa281e497deb778077ee63e7ddade90cf5c684e0e18` | 2 | **1** | 1 |
| `Opportunity North Star P1v2.zip` | 18,463 | `8805e61dbb55ee52b2c7083b57f4d1d3381e457b562ce5775308c192c44b5474` | 3 | **0** | 3 |
| `Opportunity North Star P1v3.zip` | 6,885 | `54f7f493062a2bfabe28330e66ee243193e7be777d2821c1588ba99d4d4d5a1a` | 2 | **2** | 0 |
| `Opportunity North Star P1v4.zip` | 14,315 | `74c1e5756223dcea7a8eb107951db98659a7373be8c31564c930fbd5ca114c43` | 3 | **1** | 2 |
| `Parts North Star P1v1.zip` | 9,725 | `0b3830a72c0d6320cf943048908dadaf34b3347c54a9269567ecc06fc748eae9` | 2 | **0** | 2 |
| `Parts North Star P1v2.zip` | 1,310,202 | `81a26421e718ca9ccac3de1e37473fffe2a92a29f06ebadbd2e22cb34e0e5803` | 9 | **6** | 3 |
| `Receiving North Star P1v1.zip` | 30,007 | `7a420f161467fd7bd083711194d3bff3c1908a70433e470b129d49e586951f05` | 3 | **1** | 2 |
| `Sales Agreement P1v1.zip` | 10,588 | `ad4983e08e5fd706168f987cc444606942ddb34543a5165fa2a2653087892694` | 2 | **2** | 0 |
| `Sales Order North Star P1v1.zip` | 8,276 | `4c7a635a073ce4a5ac1f639cf87d1de296fb94812c21e13c00fb19c6d543b986` | 2 | **2** | 0 |
| `Sales and Inventory Dashboards North Star P1v1.zip` | 838,355 | `afcd9793e465f5dc5808326bf63064fa76d691069b421b671e2de961f23eaad1` | 10 | **9** | 1 |
| `Sales and Inventory Dashboards North Star P1v2.zip` | 1,674,928 | `acf172dff7c966eee2393a997ae48a547c4064c607ce2671d4433d068f03877c` | 16 | **15** | 1 |
| `Scoping answers needed P1.zip` | 44,758 | `bcf78f023e9eec82bcedfffd8dd3346fb4b5aa7ddcc335f17de799f43132f650` | 7 | **6** | 1 |
| `Scoping answers needed P1v2.zip` | 51,591 | `1476cb30cf1187edc158e89298fc4e59099da082f9d4f534937da91ba6809ac8` | 8 | **7** | 1 |
| `Service Operations North Star.zip` | 15,075 | `4c528b6b3d578da6b63ae5237bd7af25dcc466f0b5ed45f1948aed30a383f415` | 3 | **1** | 2 |

Original absolute path for every archive above: `/mnt/d/Taylor_Parts/Claude Design Docs/<archive filename>`.

Four archives yielded nothing new — every member was already in the repo by content:
- `Dispatch and Schedule North Star P1v1.zip`
- `Equipment North Star P1v3.zip`
- `Lists and States North Star P2v1.zip`
- `Opportunity North Star P1v2.zip`
- `Parts North Star P1v1.zip`

---

## 3. Recovered packages

Layout: `docs/design-history/recovered/<family>/<archive-derived package>/<member path exactly as in the archive>`.
The archive's own internal structure — the `design_handoff_*/` folder and any `frames/` or `pages/`
subdirectory — is preserved verbatim, and **no recovered byte or filename was altered**. The package
directory is keyed to the *archive*, not to the internal folder name, because several archives ship
different revisions of the same filename (see D1, and the two `ns-workorder.css` / two
`NorthStarWorkOrderDetailPage.jsx` revisions in the Scoping pair). Archive-keyed paths are also what
keep a recovered copy from being mistaken for the repo's own copy of a same-named file.

### 3.1 `Customer-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Customer / Account — Account record (Customer 360) |
| **ORIGINAL ARTIFACT — archive** | `Customer North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Customer North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `b959f42ab2a644d2e43f0b680051d760bbb882c76e011fb3c44cd1a6db49123b` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Customer-Account/Customer-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | DECISIONS #128 (2026-08-26) reconciled the Account against this artifact. Migration ledger family 3, first pass `:135` and second pass `:174-176`, both read **AWAITING_OWNER_VISUAL_ACCEPTANCE**. No closed Owner visual acceptance rests on it. |
| **PRIOR P3-ARCH CLASSIFICATION** | register §3.2 row 5 — SOURCE_UNAVAILABLE; §5.5 — *affected, but the acceptance never closed* |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | YES — named visual authority of a Tier-1 decision (#128); acceptance never closed |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_account/North Star - Account P1.dc.html` | 28,636 | `23a03ffc1cea19a2c4bf386128b421cc95dbdb809133c60dec0035336e33d122` |
| `design_handoff_account/README.md` | 10,829 | `a7f5119fdcdd8c48518cc528f2aa5a1af86052dcfb2c03a84e662bd2e8fed7fd` |

### 3.2 `Sales-and-Inventory-Dashboards-North-Star-P1v2`

| | |
|---|---|
| **Family / page** | Dashboards — My Dashboard (Owner / Dispatch-Technician / Parts-Sales-Finance personas) |
| **ORIGINAL ARTIFACT — archive** | `Sales and Inventory Dashboards North Star P1v2.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Sales and Inventory Dashboards North Star P1v2.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `acf172dff7c966eee2393a997ae48a547c4064c607ce2671d4433d068f03877c` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Dashboards/Sales-and-Inventory-Dashboards-North-Star-P1v2/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md` — **CLOSED / OWNER ACCEPTED 2026-09-03**, correctives live-verified 2026-09-04 (per P3-A3 §6.3). That handoff at `:605-607` records an **open Owner item**: *"if the P1v2 artboard should also be repo-resident as a `.dc.html` canvas alongside the other nine families, it needs to be exported and committed. This document does not stand in for the visual comp."* |
| **PRIOR P3-ARCH CLASSIFICATION** | **NOT IN THE ARCHAEOLOGY SET AT ALL.** No archaeology lane classified these. The handoff `.md` was present, so the lanes read the family as "current"; the three canvases and ten frames it declines to stand in for were absent and unclassified. |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | YES — the visual comp behind a CLOSED Owner acceptance (2026-09-03), never classified as missing |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_my_dashboard/North Star - My Dashboard P1v2 Dispatch Technician.dc.html` | 26,356 | `f6ac1dd9af7280ec016b9c48aaa74b1569908a1a44ee9e74d12dc3ba6fb6e7a6` |
| `design_handoff_my_dashboard/North Star - My Dashboard P1v2 Owner.dc.html` | 31,059 | `63756204837c894719ec5ef8f6450025c5a6d5da77eacaf0a0437c97448a22af` |
| `design_handoff_my_dashboard/North Star - My Dashboard P1v2 Parts Sales Finance.dc.html` | 28,222 | `7dcb0b48cc121040810c35a51da4fe60d0468505dff09c5d84aafb66e04729f2` |
| `design_handoff_my_dashboard/README.md` | 7,745 | `32e28e3f4be0c67f065969bf900968f3cfc24d3e3c484fcb4a216c6302672bfd` |
| `design_handoff_my_dashboard/census-mapping.md` | 6,888 | `e352252d99609257b036d593c45e3602345db860328f301e6a80efa94eea4cc8` |
| `design_handoff_my_dashboard/frames/01-owner-populated-1440.png` | 332,497 | `506087348014bc3307333be6d60ddf98253a215b41adaf45f2b59a28b2f26d7b` |
| `design_handoff_my_dashboard/frames/02-owner-quiet-1440.png` | 106,794 | `107ff3c8d4d7cef15d350eb12e6ea4039fbf95cb6f51694a5ee71964a345b9c9` |
| `design_handoff_my_dashboard/frames/03-dispatcher-1440.png` | 271,455 | `64831cc65b906153ebb3105650351e9ad1abb183b467f46ae47954f72b1e221a` |
| `design_handoff_my_dashboard/frames/04-technician-1440.png` | 163,436 | `4e4e9c67d992bc62d653f14cd104fa64efcf66593e9e4017918404df96b9a7ca` |
| `design_handoff_my_dashboard/frames/05-parts-manager-1440.png` | 260,278 | `0dbba12426f7867efc66c1feb63dfe236e36980536f36253b0ef43fe7b4e7bd3` |
| `design_handoff_my_dashboard/frames/06-salesperson-1440.png` | 144,112 | `66ea6ed104550dd2da7bfd7afb1fbb48be5d10bae82a542ba973e59642cbbc47` |
| `design_handoff_my_dashboard/frames/07-finance-gated-1440.png` | 121,319 | `a44fdf164f154a3caea84141274861db9fce347ccb5e0aeb1cd0ffc7ac8f526e` |
| `design_handoff_my_dashboard/frames/08-technician-375.png` | 77,496 | `cc8202a8f2bfed046faa44f65240377bda9c680d77a48055fba567822ef605dd` |
| `design_handoff_my_dashboard/frames/09-parts-375.png` | 66,474 | `f9091e7ac92098f2da493b0de545a4122779b83e63009db66a98dd30b63dc024` |
| `design_handoff_my_dashboard/frames/10-owner-375.png` | 81,663 | `134ea39041e490d833458c7cb67b7fd0be0ad5a73468ee373d7f54f82971f6d9` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_my_dashboard/support.js` | 69,150 | `docs/north-star/financials/support.js` |

</details>

### 3.3 `Parts-North-Star-P1v2`

| | |
|---|---|
| **Family / page** | Parts — Parts workspace + Part record |
| **ORIGINAL ARTIFACT — archive** | `Parts North Star P1v2.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Parts North Star P1v2.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `81a26421e718ca9ccac3de1e37473fffe2a92a29f06ebadbd2e22cb34e0e5803` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Parts/Parts-North-Star-P1v2/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `IMPLEMENTATION-DELTA-PARTS-P1v2.md:33-37`: Design authority = `DESIGN-HANDOFF-PARTS-P1v2.md` + frames `1a`,`1a-m`,`1b`,`1b-m`; Acceptance authority = the four frames. `:20-22`: **Owner ruled on all seven items 2026-08-31 — design direction APPROVED with authority corrections.** Surface shipped; deployed `9848ec9d`. |
| **PRIOR P3-ARCH CLASSIFICATION** | register §3.5 rows 20–21 — SOURCE_UNAVAILABLE; §5.3 — *a shipped, Owner-accepted surface whose acceptance authority is unavailable*, "no fallback exists" |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | YES — design authority AND acceptance authority of a shipped surface |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_parts/DESIGN-HANDOFF-PARTS-P1v2.md` | 5,347 | `d61c56a60a2eba48fc8b984ee915e119253271fd5a73a105c270ae669e79de76` |
| `design_handoff_parts/North Star - Parts P1v2.dc.html` | 32,308 | `f87b54791b3a92b844348c26682394dad168b637c4f9f7086c06fdfa2196cebf` |
| `design_handoff_parts/frames/1a-m-workspace-375.png` | 146,570 | `1f3ee8b837a2b4a07e8c3b15427bb8ccb297ca59e98ee36e4ea3bd0a05b04e37` |
| `design_handoff_parts/frames/1a-workspace-1440.png` | 394,332 | `2f47bf5ec51fd09276816b15e805aa75314e867739747fcfbfe7495c023bc81c` |
| `design_handoff_parts/frames/1b-m-record-375.png` | 234,063 | `cab06b21d88bbc7b70697963940986ee3ee8325438ba9228b8d25bcd0244cd86` |
| `design_handoff_parts/frames/1b-record-1440.png` | 495,970 | `8c1e30008b6b81d905da4ea83877c068b5b10047ba712c420a679006aa1ffd30` |

<details><summary>3 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_parts/North Star - Parts P1.dc.html` | 28,839 | `docs/north-star/parts/North Star - Parts P1.dc.html` |
| `design_handoff_parts/README.md` | 6,166 | `docs/north-star/parts/DESIGN-HANDOFF-PARTS-P1.md` |
| `design_handoff_parts/support.js` | 69,150 | `docs/north-star/financials/support.js` |

</details>

### 3.4 `Sales-Order-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Sales Order — Sales Order detail (Family 2) |
| **ORIGINAL ARTIFACT — archive** | `Sales Order North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Sales Order North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `4c7a635a073ce4a5ac1f639cf87d1de296fb94812c21e13c00fb19c6d543b986` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Sales-Order/Sales-Order-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | DECISIONS #125 (2026-08-26) built family 2 *"with **no Design artifact in hand**"* and set `AWAITING_OWNER_VISUAL_ACCEPTANCE`. Register §3.3 row 7 records `Proposed - Sales Order.dc.html` as *"NEVER HANDED TO THIS REPOSITORY."* This archive (dated 2026-08-25 22:54, the day before #125) holds an **`Implementation Render - Sales Order.html`** — **not** `Proposed - Sales Order.dc.html`. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NEEDS OWNER REVIEW — see §7 finding F4 |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_sales_order/Implementation Render - Sales Order.html` | 13,453 | `5794defdc62ac8604719ecddab424bbe9d73b24b9cc359bd9ee2ce9af4e10b92` |
| `design_handoff_sales_order/README.md` | 8,733 | `85ce99efecf76f535077c9703bb1b8a01b9557a93cad8e9f64ee9aac064b6548` |

### 3.5 `Scoping-answers-needed-P1`

| | |
|---|---|
| **Family / page** | Scoping / Work Order — Work Order detail (Family 1) |
| **ORIGINAL ARTIFACT — archive** | `Scoping answers needed P1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Scoping answers needed P1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `bcf78f023e9eec82bcedfffd8dd3346fb4b5aa7ddcc335f17de799f43132f650` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Scoping/Scoping-answers-needed-P1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | Migration ledger `:34-41`: visual authority = `North Star - Work Order.dc.html` + `Implementation Render - Work Order.html`; **Acceptance: Closed 2026-08-25**. DECISIONS #123 (2026-08-25) is the ruling; `docs/architecture/SYSTEM_AUTHORITIES.md:19` carries it as a live authority row. |
| **PRIOR P3-ARCH CLASSIFICATION** | register §3.2 rows 3–4 and §3.3 row 6 — SOURCE_UNAVAILABLE; §5.2 — *the only CLOSED acceptance resting on unavailable authority* |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | YES — the single most load-bearing row in the register |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_work_order/North Star - Work Order.dc.html` | 21,515 | `f5cf78052a9d9a8eb023ee5875aabce5798d356c0efd3307cf96301862199ffb` |
| `design_handoff_work_order/NorthStarWorkOrderDetailPage.jsx` | 13,852 | `0531f303dbae2b18d01c1d34863e77d72a573b296b465c6a78f6ac23bf19834f` |
| `design_handoff_work_order/Proposed - Work Order.dc.html` | 23,807 | `633f6c83b2e77754f9ef091f6b03a6a24ae4b95774fde070b984db45bde0d5fd` |
| `design_handoff_work_order/README.md` | 12,097 | `694c4155c5a5b9bb5084e4b74bb997f203ca2cb4d3612d243a0667beb2b59056` |
| `design_handoff_work_order/ns-workorder.css` | 7,696 | `36fea0ebfb71003b30deb1ec43f9ec544ed34c1d38622a0c57b22cd854018cb2` |
| `design_handoff_work_order/pilot-menu.js` | 7,196 | `eb41fbe3c53c7175ef6a01e69ef50d4ef331d13175d71d3e0131ff4063391858` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_work_order/support.js` | 69,150 | `docs/north-star/financials/support.js` |

</details>

### 3.6 `Scoping-answers-needed-P1v2`

| | |
|---|---|
| **Family / page** | Scoping / Work Order — Work Order detail (Family 1) |
| **ORIGINAL ARTIFACT — archive** | `Scoping answers needed P1v2.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Scoping answers needed P1v2.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `1476cb30cf1187edc158e89298fc4e59099da082f9d4f534937da91ba6809ac8` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Scoping/Scoping-answers-needed-P1v2/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | Same acceptance as P1. This archive additionally holds `Implementation Render - Work Order.html`, the second of the two artifacts DECISIONS #123 names, and later revisions of the JSX and CSS. |
| **PRIOR P3-ARCH CLASSIFICATION** | register §3.2 rows 3–4 and §3.3 row 6 — SOURCE_UNAVAILABLE; §5.2 |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | YES — supplies the *pixel target* artifact, register row 4 |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_work_order/Implementation Render - Work Order.html` | 8,561 | `2265dc3319b18193c5ac07d3624c884757429918c4d3a2ffe91f3518adfb5714` |
| `design_handoff_work_order/North Star - Work Order.dc.html` | 21,515 | `f5cf78052a9d9a8eb023ee5875aabce5798d356c0efd3307cf96301862199ffb` |
| `design_handoff_work_order/NorthStarWorkOrderDetailPage.jsx` | 17,407 | `63a1ef8223e9971a41cc2a3818697e4e2ce7d087fe9cb09c0ed90fb9ddb45dec` |
| `design_handoff_work_order/Proposed - Work Order.dc.html` | 23,807 | `633f6c83b2e77754f9ef091f6b03a6a24ae4b95774fde070b984db45bde0d5fd` |
| `design_handoff_work_order/README.md` | 16,273 | `fd22cd89d58c2566c357dd4ed9c42b1cf6070efc5b69e87cc0fa66ac9834c494` |
| `design_handoff_work_order/ns-workorder.css` | 11,254 | `699f4a2811d4980bb49f0cd8267616609706e1c7075863fc2e25cbdb9ef10cdc` |
| `design_handoff_work_order/pilot-menu.js` | 7,196 | `eb41fbe3c53c7175ef6a01e69ef50d4ef331d13175d71d3e0131ff4063391858` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_work_order/support.js` | 69,150 | `docs/north-star/financials/support.js` |

</details>

### 3.7 `Sales-and-Inventory-Dashboards-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Dashboards — Sales Dashboard, Inventory Dashboard |
| **ORIGINAL ARTIFACT — archive** | `Sales and Inventory Dashboards North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Sales and Inventory Dashboards North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `afcd9793e465f5dc5808326bf63064fa76d691069b421b671e2de961f23eaad1` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Dashboards/Sales-and-Inventory-Dashboards-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | No acceptance record found at baseline for either canvas. Superseded in direction by the P1v2 My Dashboard persona model. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_dashboards/North Star - Inventory Dashboard.dc.html` | 26,640 | `5597215e27c378fad8c567e440aa35b3080cf6c10431c4bdec0afbe31dd64e71` |
| `design_handoff_dashboards/North Star - Sales Dashboard.dc.html` | 28,818 | `382afb85c82290c95e88d9512c119b4d3c252b89e082a0e8405381cc03a1a46d` |
| `design_handoff_dashboards/README.md` | 1,255 | `2692a6d691d901c61c3d66578249897d53592495a757e054fd5cbcff53ee21e0` |
| `design_handoff_dashboards/frames/inventory-dashboard-1440.png` | 336,758 | `800b0e24889f6c73b3213e49eb23c23d3fae9e8ab8e5fa8acb3e90780dc30ac7` |
| `design_handoff_dashboards/frames/inventory-dashboard-375.png` | 64,860 | `aea31c65ccc8b1448143c19ea115098c6175c7e4e0bb0e233f4070f51325b045` |
| `design_handoff_dashboards/frames/sales-dashboard-1440.png` | 339,760 | `d78f4fdaa4803b9f4a9b5dd6aae91ce03786cf2b5965a9d83c892ef9f0941a4e` |
| `design_handoff_dashboards/frames/sales-dashboard-375.png` | 59,533 | `da90438d5a788f62d67b7a8741caec787494c2f0e7d2d9f3eb174cb95f3d55e1` |
| `design_handoff_dashboards/pages/inventory-dashboard.md` | 2,890 | `e32e104697b3c1bdbb2465a3148351a3ec39b52d235908fd51d6474ae3ab95f1` |
| `design_handoff_dashboards/pages/sales-dashboard.md` | 2,904 | `0d187b26f516a77ae7f33e7132830e5872640f4beef253b8f8b48b87821aedf2` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_dashboards/support.js` | 69,150 | `docs/north-star/financials/support.js` |

</details>

### 3.8 `Equipment-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Equipment — Equipment record |
| **ORIGINAL ARTIFACT — archive** | `Equipment North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Equipment North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `65d6f595a03833a51311577efaea45abf8735875f93592bfa50643399b4dc7b9` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Equipment/Equipment-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `North Star - Equipment P1.dc.html` is already vendored. The repo carries only the P1v3-era `DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md`; this is the P1v1-era package README. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_equipment/README.md` | 5,605 | `118b3f354410706bd3a251c35c05848b2a89082d8441b85e55005184079a8c75` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_equipment/North Star - Equipment P1.dc.html` | 26,063 | `docs/north-star/equipment/North Star - Equipment P1.dc.html` |

</details>

### 3.9 `Equipment-North-Star-P1v2`

| | |
|---|---|
| **Family / page** | Equipment — Equipment record |
| **ORIGINAL ARTIFACT — archive** | `Equipment North Star P1v2.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Equipment North Star P1v2.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `2837a10b385815b994e24e409c8d4eef6c3149449e2be7d71f87c87b85a6644f` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Equipment/Equipment-North-Star-P1v2/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | **Byte-divergence finding D1.** The repo's `docs/north-star/equipment/North Star - Equipment P1v2.dc.html` (32,950 B) is the copy shipped in `Equipment North Star P1v3.zip`, **not** the copy in the P1v2 archive (32,718 B). The same filename carries two different revisions. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set — the register treated `North Star - Equipment P1v2.dc.html` as simply *present* |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO — but see divergence finding D1 |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_equipment/North Star - Equipment P1v2.dc.html` | 32,718 | `3527a0ddc352433a21c00dd51d5050fa887cbad92003c62e356e1788bbdc2133` |
| `design_handoff_equipment/README.md` | 8,983 | `a9ac99ef2ff830108c933dbf56f2b7792ba89e8354259f3fcfd34b76a4a29cf3` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_equipment/North Star - Equipment P1.dc.html` | 26,063 | `docs/north-star/equipment/North Star - Equipment P1.dc.html` |

</details>

### 3.10 `Financials-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Financials — Financials 16 Reconciliation, 20 Governance |
| **ORIGINAL ARTIFACT — archive** | `Financials North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Financials North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `30fabe0e5fe55fcda01c89d229c6686ccbd32aec3e506866e466793a4ab097fb` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Financials/Financials-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | **Byte-divergence findings D2 and D3.** 48 of the 50 Financials canvases/frames are byte-identical to the repo. Two canvases are not: the repo's copies are **larger** than the delivered copies (16: 12,244 B vs 10,273 B; 20: 13,391 B vs 12,022 B), i.e. edited after vendoring or replaced by a later revision under the same name. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set — the register counted all 20 Financials canvases as present |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO — but see divergence findings D2, D3 |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_financials/North Star - Financials 16 Reconciliation.dc.html` | 10,273 | `67864d644bb627bb8ac921df2b090b2059a601cc3f8e9bfe2bd28cfe9a5f0ef3` |
| `design_handoff_financials/North Star - Financials 20 Governance.dc.html` | 12,022 | `4e1b2c40eb11a63c1a2adf68c30601a5af7069ad152b7fcac355148687fac403` |

<details><summary>93 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_financials/DESIGN-HANDOFF-FINANCIALS-P1.md` | 80,569 | `docs/north-star/financials/DESIGN-HANDOFF-FINANCIALS-P1.md` |
| `design_handoff_financials/FINANCIALS-NORTH-STAR-P1-DESIGN-REVIEW-PACKAGE.md` | 95,017 | `docs/north-star/financials/FINANCIALS-NORTH-STAR-P1-DESIGN-REVIEW-PACKAGE.md` |
| `design_handoff_financials/North Star - Financials 01 Overview.dc.html` | 23,086 | `docs/north-star/financials/North Star - Financials 01 Overview.dc.html` |
| `design_handoff_financials/North Star - Financials 02 Billing Queue.dc.html` | 23,128 | `docs/north-star/financials/North Star - Financials 02 Billing Queue.dc.html` |
| `design_handoff_financials/North Star - Financials 03 Invoices.dc.html` | 22,767 | `docs/north-star/financials/North Star - Financials 03 Invoices.dc.html` |
| `design_handoff_financials/North Star - Financials 04 Accounts Receivable.dc.html` | 16,596 | `docs/north-star/financials/North Star - Financials 04 Accounts Receivable.dc.html` |
| `design_handoff_financials/North Star - Financials 05 Payments.dc.html` | 20,289 | `docs/north-star/financials/North Star - Financials 05 Payments.dc.html` |
| `design_handoff_financials/North Star - Financials 06 Credits Adjustments.dc.html` | 14,492 | `docs/north-star/financials/North Star - Financials 06 Credits Adjustments.dc.html` |
| `design_handoff_financials/North Star - Financials 07 Customer Financials.dc.html` | 17,038 | `docs/north-star/financials/North Star - Financials 07 Customer Financials.dc.html` |
| `design_handoff_financials/North Star - Financials 08 Sales to Goal.dc.html` | 14,629 | `docs/north-star/financials/North Star - Financials 08 Sales to Goal.dc.html` |
| `design_handoff_financials/North Star - Financials 09 Cost to Budget.dc.html` | 13,048 | `docs/north-star/financials/North Star - Financials 09 Cost to Budget.dc.html` |
| `design_handoff_financials/North Star - Financials 10 Forecasting.dc.html` | 15,090 | `docs/north-star/financials/North Star - Financials 10 Forecasting.dc.html` |
| `design_handoff_financials/North Star - Financials 11 Profitability.dc.html` | 12,703 | `docs/north-star/financials/North Star - Financials 11 Profitability.dc.html` |
| `design_handoff_financials/North Star - Financials 12 Budget Management.dc.html` | 18,609 | `docs/north-star/financials/North Star - Financials 12 Budget Management.dc.html` |
| `design_handoff_financials/North Star - Financials 13 Goal Management.dc.html` | 17,463 | `docs/north-star/financials/North Star - Financials 13 Goal Management.dc.html` |
| `design_handoff_financials/North Star - Financials 14 Company Performance.dc.html` | 14,631 | `docs/north-star/financials/North Star - Financials 14 Company Performance.dc.html` |
| `design_handoff_financials/North Star - Financials 15 Employee Performance.dc.html` | 13,802 | `docs/north-star/financials/North Star - Financials 15 Employee Performance.dc.html` |
| `design_handoff_financials/North Star - Financials 17 Intercompany.dc.html` | 11,781 | `docs/north-star/financials/North Star - Financials 17 Intercompany.dc.html` |
| `design_handoff_financials/North Star - Financials 18 Audit History.dc.html` | 11,967 | `docs/north-star/financials/North Star - Financials 18 Audit History.dc.html` |
| `design_handoff_financials/North Star - Financials 19 Reports Exports.dc.html` | 13,103 | `docs/north-star/financials/North Star - Financials 19 Reports Exports.dc.html` |
| `design_handoff_financials/README.md` | 3,205 | `docs/north-star/financials/README.md` |
| `design_handoff_financials/frames/01-overview-1440.png` | 241,578 | `docs/north-star/financials/frames/01-overview-1440.png` |
| `design_handoff_financials/frames/01-overview-375.png` | 80,649 | `docs/north-star/financials/frames/01-overview-375.png` |
| `design_handoff_financials/frames/02-billing-queue-1440.png` | 213,674 | `docs/north-star/financials/frames/02-billing-queue-1440.png` |
| `design_handoff_financials/frames/02-billing-queue-375.png` | 60,459 | `docs/north-star/financials/frames/02-billing-queue-375.png` |
| `design_handoff_financials/frames/02-billing-queue-item-1440.png` | 97,784 | `docs/north-star/financials/frames/02-billing-queue-item-1440.png` |
| `design_handoff_financials/frames/02-billing-queue-item-375.png` | 43,944 | `docs/north-star/financials/frames/02-billing-queue-item-375.png` |
| `design_handoff_financials/frames/03-invoice-record-1440.png` | 141,877 | `docs/north-star/financials/frames/03-invoice-record-1440.png` |
| `design_handoff_financials/frames/03-invoice-record-375.png` | 48,926 | `docs/north-star/financials/frames/03-invoice-record-375.png` |
| `design_handoff_financials/frames/03-invoices-1440.png` | 182,285 | `docs/north-star/financials/frames/03-invoices-1440.png` |
| `design_handoff_financials/frames/03-invoices-375.png` | 44,866 | `docs/north-star/financials/frames/03-invoices-375.png` |
| `design_handoff_financials/frames/04-accounts-receivable-1440.png` | 203,492 | `docs/north-star/financials/frames/04-accounts-receivable-1440.png` |
| `design_handoff_financials/frames/04-accounts-receivable-375.png` | 54,955 | `docs/north-star/financials/frames/04-accounts-receivable-375.png` |
| `design_handoff_financials/frames/05-payment-record-1440.png` | 116,798 | `docs/north-star/financials/frames/05-payment-record-1440.png` |
| `design_handoff_financials/frames/05-payment-record-375.png` | 39,411 | `docs/north-star/financials/frames/05-payment-record-375.png` |
| `design_handoff_financials/frames/05-payments-1440.png` | 172,671 | `docs/north-star/financials/frames/05-payments-1440.png` |
| `design_handoff_financials/frames/05-payments-375.png` | 47,818 | `docs/north-star/financials/frames/05-payments-375.png` |
| `design_handoff_financials/frames/06-credits-adjustments-1440.png` | 188,558 | `docs/north-star/financials/frames/06-credits-adjustments-1440.png` |
| `design_handoff_financials/frames/06-credits-adjustments-375.png` | 50,182 | `docs/north-star/financials/frames/06-credits-adjustments-375.png` |
| `design_handoff_financials/frames/07-customer-financials-1440.png` | 222,589 | `docs/north-star/financials/frames/07-customer-financials-1440.png` |
| `design_handoff_financials/frames/07-customer-financials-375.png` | 62,222 | `docs/north-star/financials/frames/07-customer-financials-375.png` |
| `design_handoff_financials/frames/08-sales-to-goal-1440.png` | 197,962 | `docs/north-star/financials/frames/08-sales-to-goal-1440.png` |
| `design_handoff_financials/frames/08-sales-to-goal-375.png` | 49,941 | `docs/north-star/financials/frames/08-sales-to-goal-375.png` |
| `design_handoff_financials/frames/09-cost-to-budget-1440.png` | 167,339 | `docs/north-star/financials/frames/09-cost-to-budget-1440.png` |
| `design_handoff_financials/frames/09-cost-to-budget-375.png` | 50,638 | `docs/north-star/financials/frames/09-cost-to-budget-375.png` |
| `design_handoff_financials/frames/10-forecasting-1440.png` | 224,844 | `docs/north-star/financials/frames/10-forecasting-1440.png` |
| `design_handoff_financials/frames/10-forecasting-375.png` | 49,488 | `docs/north-star/financials/frames/10-forecasting-375.png` |
| `design_handoff_financials/frames/11-profitability-1440.png` | 214,370 | `docs/north-star/financials/frames/11-profitability-1440.png` |
| `design_handoff_financials/frames/11-profitability-375.png` | 46,880 | `docs/north-star/financials/frames/11-profitability-375.png` |
| `design_handoff_financials/frames/12-budget-review-375.png` | 36,122 | `docs/north-star/financials/frames/12-budget-review-375.png` |
| `design_handoff_financials/frames/12-budget-revise-1440.png` | 82,004 | `docs/north-star/financials/frames/12-budget-revise-1440.png` |
| `design_handoff_financials/frames/12-budgets-1440.png` | 162,127 | `docs/north-star/financials/frames/12-budgets-1440.png` |
| `design_handoff_financials/frames/12-budgets-375.png` | 41,373 | `docs/north-star/financials/frames/12-budgets-375.png` |
| `design_handoff_financials/frames/13-goal-create-1440.png` | 56,825 | `docs/north-star/financials/frames/13-goal-create-1440.png` |
| `design_handoff_financials/frames/13-goal-review-375.png` | 25,944 | `docs/north-star/financials/frames/13-goal-review-375.png` |
| `design_handoff_financials/frames/13-goals-1440.png` | 154,920 | `docs/north-star/financials/frames/13-goals-1440.png` |
| `design_handoff_financials/frames/13-goals-375.png` | 37,104 | `docs/north-star/financials/frames/13-goals-375.png` |
| `design_handoff_financials/frames/14-company-performance-1440.png` | 207,443 | `docs/north-star/financials/frames/14-company-performance-1440.png` |
| `design_handoff_financials/frames/14-company-performance-375.png` | 54,814 | `docs/north-star/financials/frames/14-company-performance-375.png` |
| `design_handoff_financials/frames/15-employee-performance-1440.png` | 192,590 | `docs/north-star/financials/frames/15-employee-performance-1440.png` |
| `design_handoff_financials/frames/15-employee-performance-375-self.png` | 54,276 | `docs/north-star/financials/frames/15-employee-performance-375-self.png` |
| `design_handoff_financials/frames/16-reconciliation-1440.png` | 155,661 | `docs/north-star/financials/frames/16-reconciliation-1440.png` |
| `design_handoff_financials/frames/16-reconciliation-375.png` | 43,450 | `docs/north-star/financials/frames/16-reconciliation-375.png` |
| `design_handoff_financials/frames/17-intercompany-1440.png` | 155,730 | `docs/north-star/financials/frames/17-intercompany-1440.png` |
| `design_handoff_financials/frames/17-intercompany-375.png` | 40,679 | `docs/north-star/financials/frames/17-intercompany-375.png` |
| `design_handoff_financials/frames/18-audit-1440.png` | 180,527 | `docs/north-star/financials/frames/18-audit-1440.png` |
| `design_handoff_financials/frames/18-audit-375.png` | 49,670 | `docs/north-star/financials/frames/18-audit-375.png` |
| `design_handoff_financials/frames/19-reports-1440.png` | 214,707 | `docs/north-star/financials/frames/19-reports-1440.png` |
| `design_handoff_financials/frames/19-reports-375.png` | 48,296 | `docs/north-star/financials/frames/19-reports-375.png` |
| `design_handoff_financials/frames/20-governance-1440.png` | 189,132 | `docs/north-star/financials/frames/20-governance-1440.png` |
| `design_handoff_financials/frames/20-governance-375.png` | 43,726 | `docs/north-star/financials/frames/20-governance-375.png` |
| `design_handoff_financials/frames/README.md` | 2,629 | `docs/north-star/financials/frames/README.md` |
| `design_handoff_financials/pages/01-overview.md` | 4,603 | `docs/north-star/financials/pages/01-overview.md` |
| `design_handoff_financials/pages/02-billing-queue.md` | 4,513 | `docs/north-star/financials/pages/02-billing-queue.md` |
| `design_handoff_financials/pages/03-invoices.md` | 4,610 | `docs/north-star/financials/pages/03-invoices.md` |
| `design_handoff_financials/pages/04-accounts-receivable.md` | 3,952 | `docs/north-star/financials/pages/04-accounts-receivable.md` |
| `design_handoff_financials/pages/05-payments.md` | 4,279 | `docs/north-star/financials/pages/05-payments.md` |
| `design_handoff_financials/pages/06-credits-adjustments.md` | 4,103 | `docs/north-star/financials/pages/06-credits-adjustments.md` |
| `design_handoff_financials/pages/07-customer-financials.md` | 3,901 | `docs/north-star/financials/pages/07-customer-financials.md` |
| `design_handoff_financials/pages/08-sales-to-goal.md` | 3,688 | `docs/north-star/financials/pages/08-sales-to-goal.md` |
| `design_handoff_financials/pages/09-cost-to-budget.md` | 3,597 | `docs/north-star/financials/pages/09-cost-to-budget.md` |
| `design_handoff_financials/pages/10-forecasting.md` | 3,990 | `docs/north-star/financials/pages/10-forecasting.md` |
| `design_handoff_financials/pages/11-profitability.md` | 3,697 | `docs/north-star/financials/pages/11-profitability.md` |
| `design_handoff_financials/pages/12-budgets.md` | 4,039 | `docs/north-star/financials/pages/12-budgets.md` |
| `design_handoff_financials/pages/13-goals.md` | 3,725 | `docs/north-star/financials/pages/13-goals.md` |
| `design_handoff_financials/pages/14-company-performance.md` | 3,959 | `docs/north-star/financials/pages/14-company-performance.md` |
| `design_handoff_financials/pages/15-employee-performance.md` | 4,178 | `docs/north-star/financials/pages/15-employee-performance.md` |
| `design_handoff_financials/pages/16-reconciliation.md` | 3,722 | `docs/north-star/financials/pages/16-reconciliation.md` |
| `design_handoff_financials/pages/17-intercompany.md` | 3,690 | `docs/north-star/financials/pages/17-intercompany.md` |
| `design_handoff_financials/pages/18-audit.md` | 3,812 | `docs/north-star/financials/pages/18-audit.md` |
| `design_handoff_financials/pages/19-reports.md` | 3,794 | `docs/north-star/financials/pages/19-reports.md` |
| `design_handoff_financials/pages/20-governance.md` | 3,949 | `docs/north-star/financials/pages/20-governance.md` |
| `design_handoff_financials/support.js` | 69,150 | `docs/north-star/financials/support.js` |

</details>

### 3.11 `Lists-and-States-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Lists — Dense list + honest states, P1 |
| **ORIGINAL ARTIFACT — archive** | `Lists and States North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Lists and States North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `baaa45fb6130034d786bac0fbf4b4a215c1202b9736b04b053577292dd352989` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Lists/Lists-and-States-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `Lists-North-Star-P1.dc.html` is already vendored (byte-identical, renamed). The repo carries `DESIGN-HANDOFF-LISTS-P2.md` but no P1 handoff; the P1 package README is that missing document. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_lists/README.md` | 6,645 | `d06e50429d2f3eb2690fc13cd09e47becde535d8868b75349323f782c29e4c64` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_lists/North Star - Lists P1.dc.html` | 33,435 | `docs/north-star/lists/Lists-North-Star-P1.dc.html` |

</details>

### 3.12 `Opportunity-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Opportunity — Opportunity detail |
| **ORIGINAL ARTIFACT — archive** | `Opportunity North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Opportunity North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `7da93372fd81dc53c9b83fa281e497deb778077ee63e7ddade90cf5c684e0e18` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Opportunity/Opportunity-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `Opportunity-North-Star-P1v1.dc.html` is already vendored (byte-identical, renamed). Only the package handoff README is new. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_opportunity/README.md` | 8,756 | `a6a62757c0259bebbaa3af2db848a8acf92a396a3c7f725fd1c4b071b839192d` |

<details><summary>1 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_opportunity/North Star - Opportunity P1.dc.html` | 24,341 | `docs/north-star/opportunity/Opportunity-North-Star-P1v1.dc.html` |

</details>

### 3.13 `Opportunity-North-Star-P1v3`

| | |
|---|---|
| **Family / page** | Opportunity — Opportunity workspace (list-plus-record) |
| **ORIGINAL ARTIFACT — archive** | `Opportunity North Star P1v3.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Opportunity North Star P1v3.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `54f7f493062a2bfabe28330e66ee243193e7be777d2821c1588ba99d4d4d5a1a` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Opportunity/Opportunity-North-Star-P1v3/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | No acceptance record at baseline for the workspace canvas. `Opportunity-North-Star-List-P1v4.dc.html` (its successor) is present. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_opportunity_workspace/North Star - Opportunity Workspace P1.dc.html` | 20,250 | `a10bb6cae0e7017202d1221f680b0a0c6b3fa84650ca322d946e5a6fd102933c` |
| `design_handoff_opportunity_workspace/README.md` | 4,819 | `b23b7915d06a7b3076b9218c378b5863cb13a041c713d8d71c83a2ce0e8a57e9` |

### 3.14 `Opportunity-North-Star-P1v4`

| | |
|---|---|
| **Family / page** | Opportunity — Opportunity workspace / list |
| **ORIGINAL ARTIFACT — archive** | `Opportunity North Star P1v4.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Opportunity North Star P1v4.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `74c1e5756223dcea7a8eb107951db98659a7373be8c31564c930fbd5ca114c43` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Opportunity/Opportunity-North-Star-P1v4/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `Opportunity-North-Star-List-P1v4.dc.html` is already vendored (byte-identical, renamed). Only the workspace canvas is new here. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_opportunity_workspace/North Star - Opportunity Workspace P1.dc.html` | 20,250 | `a10bb6cae0e7017202d1221f680b0a0c6b3fa84650ca322d946e5a6fd102933c` |

<details><summary>2 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_opportunity_workspace/North Star - Opportunity List P1v4.dc.html` | 34,406 | `docs/north-star/opportunity/Opportunity-North-Star-List-P1v4.dc.html` |
| `design_handoff_opportunity_workspace/README.md` | 6,364 | `docs/north-star/opportunity/DESIGN-HANDOFF-LIST-P1v4.md` |

</details>

### 3.15 `Receiving-North-Star-P1v1`

| | |
|---|---|
| **Family / page** | Receiving — Receiving |
| **ORIGINAL ARTIFACT — archive** | `Receiving North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Receiving North Star P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `7a420f161467fd7bd083711194d3bff3c1908a70433e470b129d49e586951f05` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Receiving/Receiving-North-Star-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `North Star - Receiving P1.dc.html` is already vendored. The repo's `DESIGN-HANDOFF-RECEIVING-P1.md` is a **different document** from this package README (content differs). |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_receiving/README.md` | 4,859 | `5128c11b1a636ea3c0772c0e427f8a303ec934c6f8fb61e351ef367c1ac4af88` |

<details><summary>2 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_receiving/North Star - Receiving P1.dc.html` | 39,437 | `docs/north-star/receiving/North Star - Receiving P1.dc.html` |
| `design_handoff_receiving/support.js` | 69,150 | `docs/north-star/financials/support.js` |

</details>

### 3.16 `Sales-Agreement-P1v1`

| | |
|---|---|
| **Family / page** | Sales Agreement — Sales Agreement record |
| **ORIGINAL ARTIFACT — archive** | `Sales Agreement P1v1.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Sales Agreement P1v1.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `ad4983e08e5fd706168f987cc444606942ddb34543a5165fa2a2653087892694` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Sales-Agreement/Sales-Agreement-P1v1/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `North Star - Sales Agreement P1v2.dc.html` **is present** at `docs/north-star/sales-agreement/`; this is its P1 predecessor. Register §3.4 row 17 notes the record surface was superseded 2026-08-26. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set (only the `Subpages - Commercial.dc.html` ancestor was) |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO — superseded by a present successor |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_sales_agreement/North Star - Sales Agreement P1.dc.html` | 28,227 | `f63f00e254a373327ed055384fb0e74d3f05fc773a81b1b17c012be1d3c9fe90` |
| `design_handoff_sales_agreement/README.md` | 9,760 | `b69af6c72eb08f94dd366eb665350f2eb0042ffefd5b52f9dd2bd05a734a5b43` |

### 3.17 `Service-Operations-North-Star`

| | |
|---|---|
| **Family / page** | Service Operations — Service Operations P1 |
| **ORIGINAL ARTIFACT — archive** | `Service Operations North Star.zip` |
| **ORIGINAL ARTIFACT — absolute path** | `/mnt/d/Taylor_Parts/Claude Design Docs/Service Operations North Star.zip` |
| **ORIGINAL ARTIFACT — archive SHA-256** | `4c528b6b3d578da6b63ae5237bd7af25dcc466f0b5ed45f1948aed30a383f415` |
| **RECOVERED COPY — location** | `docs/design-history/recovered/Service-Operations/Service-Operations-North-Star/` |
| **RECOVERED COPY — recovery date** | 2026-09-13 |
| **HISTORICAL ACCEPTANCE STATUS** | `North Star - Service Operations P1.dc.html` and the package README are already vendored byte-identically. `CLAUDE-CODE-HANDOFF.md` is a distinct implementation-handoff document not in the repo. |
| **PRIOR P3-ARCH CLASSIFICATION** | not in the archaeology set |
| **LOAD-BEARING ACCEPTANCE EVIDENCE?** | NO |
| **CURRENT AUTHORITY STATUS** | **NONE — recovered historical design evidence only.** |

| Member (RECOVERED COPY) | Bytes | SHA-256 (verified) |
|---|---|---|
| `design_handoff_service_operations/CLAUDE-CODE-HANDOFF.md` | 11,365 | `7a70b54a140ba83451caa53aa1a94a0843e561fcea49c70ca66679203806a837` |

<details><summary>2 member(s) of this archive already in the repo by content — not recovered</summary>

| Member | Bytes | Already at |
|---|---|---|
| `design_handoff_service_operations/North Star - Service Operations P1.dc.html` | 27,931 | `docs/north-star/service-operations/North Star - Service Operations P1.dc.html` |
| `design_handoff_service_operations/README.md` | 5,651 | `docs/north-star/service-operations/README.md` |

</details>

---

## 4. Corrections to the inherited census figures

The lane brief carried measured totals. Re-derived from the archives themselves, the archive-level
figures are exact and the "genuinely new" figures are not.

| Figure | Brief | Re-derived | Verdict |
|---|---|---|---|
| Archives | 22 | **22** | correct |
| Archive bytes | 9,884,937 | **9,884,937** | correct |
| Contained files | 184 | **184** | correct |
| Contained bytes (uncompressed) | 11,480,254 | **11,480,254** | correct |
| Contained files already in the repo **by basename** | 132 (7,070,127 B) | **132 (7,070,127 B)** | correct as stated — but see below, the predicate is wrong |
| Genuinely new | **44 files, 4,258,035 B** | **61 entries / 57 distinct blobs, 4,336,161 B written / 4,263,393 B distinct** | **understated** |
| New `.dc.html` (`new_dc.txt`) | 16 | **11 genuinely new; 5 already vendored under renamed paths** | **overstated by 5** |
| Package `README.md` entries in the archives | not stated | **23 — 13 absent by content, 10 already present** | — |
| Repository's own `README.md` files at baseline | not stated | **44** | — |

Also independently re-verified: **`census.json` is byte-accurate.** Every archive SHA-256, every
member SHA-256 and every byte count in it was recomputed from the archives and matched with **zero
discrepancies**. The census is sound; the *inference drawn from it* is what needed correcting.

**Correction 1 — basename matching is wrong in both directions.** The "132 already exist" figure
counts every package `README.md` as present because the repository contains **44** `README.md` files
of its own. A package `README.md` is the design-handoff document for that package; it is not the repo's
README. The archives hold **23** `README.md` entries: **13 are genuinely absent** from the repo by
content and are recovered here, and **10 are already present** — 7 of those renamed on vendoring to
`DESIGN-HANDOFF-*.md` (Dispatch Board P1, Equipment P1v2.1, Lists P2, Opportunity P1v2, Opportunity
List P1v4, and Parts P1 twice), which basename matching cannot see either, plus 3 vendored as
`README.md` (Financials, Financials `frames/`, Service Operations).

**Correction 2 — five of the sixteen `.dc.html` in `new_dc.txt` are already vendored**, byte-identical,
under renamed paths. They are not recovered here because there is nothing to recover:

| `new_dc.txt` entry | Already present at, byte-identical |
|---|---|
| `North Star - Lists P1.dc.html` | `docs/north-star/lists/Lists-North-Star-P1.dc.html` |
| `North Star - Lists P2.dc.html` | `docs/north-star/lists/Lists-North-Star-P2.dc.html` |
| `North Star - Opportunity P1.dc.html` | `docs/north-star/opportunity/Opportunity-North-Star-P1v1.dc.html` |
| `North Star - Opportunity P1v2.dc.html` | `docs/north-star/opportunity/Opportunity-North-Star-P1v2.dc.html` |
| `North Star - Opportunity List P1v4.dc.html` | `docs/north-star/opportunity/Opportunity-North-Star-List-P1v4.dc.html` |

The eleven that are genuinely new: `North Star - Account P1.dc.html`,
`North Star - Inventory Dashboard.dc.html`, `North Star - My Dashboard P1v2 Dispatch Technician.dc.html`,
`North Star - My Dashboard P1v2 Owner.dc.html`, `North Star - My Dashboard P1v2 Parts Sales Finance.dc.html`,
`North Star - Opportunity Workspace P1.dc.html`, `North Star - Parts P1v2.dc.html`,
`North Star - Sales Agreement P1.dc.html`, `North Star - Sales Dashboard.dc.html`,
`North Star - Work Order.dc.html`, `Proposed - Work Order.dc.html`. Plus three non-`.dc` HTML files
the brief did not name: `Implementation Render - Work Order.html`,
`Implementation Render - Sales Order.html`, and `North Star - Equipment P1v2.dc.html` in its
divergent P1v2-archive revision.

**Correction 3 — two artifacts exist in two different revisions** and were deduplicated away by
basename. `Scoping answers needed P1.zip` and `P1v2.zip` each carry a *different*
`NorthStarWorkOrderDetailPage.jsx` (13,852 B / 17,407 B) and a *different* `ns-workorder.css`
(7,696 B / 11,254 B). Both revisions of each are recovered, under their archive-keyed paths.

---

## 5. Reclassification against the P3-ARCH register

Applied to `docs/design/archaeology/historical-acceptance-evidence-register.md` §3 rows 1–25.

| Rows | Count | New classification |
|---|---|---|
| 3, 4, 5, 6, 20, 21 | **6 rows / 9 named files** | **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** |
| 24, 25 | **2 rows** | Artifacts **still SOURCE_UNAVAILABLE**; the **UNPROVEN membership question is now PROVEN** (§7 F1) |
| 1, 2, 7–19, 22, 23 | **17 rows / 20 named files** | **unchanged — SOURCE_UNAVAILABLE.** Names corroborated for 15 of them (§7 F1); no file recovered |

**The nine named files recovered, row by row:**

| Row | Artifact | Recovered from | Recovered copy |
|---|---|---|---|
| 3 | `North Star - Work Order.dc.html` | `Scoping answers needed P1.zip` (and P1v2) | `Scoping/Scoping-answers-needed-P1/design_handoff_work_order/North Star - Work Order.dc.html` |
| 4 | `Implementation Render - Work Order.html` | `Scoping answers needed P1v2.zip` | `Scoping/Scoping-answers-needed-P1v2/design_handoff_work_order/Implementation Render - Work Order.html` |
| 5 | `North Star - Account P1.dc.html` | `Customer North Star P1v1.zip` | `Customer-Account/Customer-North-Star-P1v1/design_handoff_account/North Star - Account P1.dc.html` |
| 6 | `Proposed - Work Order.dc.html` | `Scoping answers needed P1.zip` (and P1v2) | `Scoping/Scoping-answers-needed-P1/design_handoff_work_order/Proposed - Work Order.dc.html` |
| 20 | `DESIGN-HANDOFF-PARTS-P1v2.md` | `Parts North Star P1v2.zip` | `Parts/Parts-North-Star-P1v2/design_handoff_parts/DESIGN-HANDOFF-PARTS-P1v2.md` |
| 21 | frames `1a`, `1a-m`, `1b`, `1b-m` (4 files) | `Parts North Star P1v2.zip` | `Parts/Parts-North-Star-P1v2/design_handoff_parts/frames/` |

**What this changes about the three affected acceptances — and what it does not.**

| Acceptance | Before | After | What is still not established |
|---|---|---|---|
| Family 1 Work Order — **Closed 2026-08-25** | both named authorities SOURCE_UNAVAILABLE; *"visual conformance permanently unauditable"* | **both authorities available.** Conformance is now **auditable in principle** | **Nobody has run the audit.** Whether the shipped Work Order matches these two artifacts is **UNKNOWN** — recovering the yardstick is not measuring with it |
| Parts P1v2 — Owner-ruled 2026-08-31, **shipped** | design authority + acceptance authority both unavailable, *"no fallback exists"* | **handoff and all four frames available** | The surface has changed since `9848ec9d`. The frames show the accepted state, **not the current state.** Register §3.5 artifact 23 (the four `audit-*.png`) is **still unavailable** |
| Account — `AWAITING_OWNER_VISUAL_ACCEPTANCE` | authority of DECISIONS #128 unavailable | **authority available**; the #128 reconciliation is re-runnable | The acceptance **is still open.** Recovery does not close it |

**The `design_handoff_account/` path is now explained.** Register §5.5 flagged that `DECISIONS.md:2168`
cites `design_handoff_account/North Star - Account P1.dc.html` — *"a delivery-folder path, not a
repository path."* It is the exact internal path inside `Customer North Star P1v1.zip`. The citation
was correct all along; it pointed into a delivery that was never vendored.

---

## 6. What was deliberately kept outside git, and why

### 6.1 The archives themselves
The 22 `.zip` files (9,884,937 B) are **not** committed. 7,144,093 B of their contents — 123 of 184
entries, overwhelmingly the 50 Financials PNGs and the shared `support.js` — are already in the
repository. Committing the zips would add ~9.43 MB to carry ~4.26 MB of new content and would
introduce a second, opaque copy of files the repo already tracks. The extracted new-only artifacts
are committed instead: **4,336,161 B in 61 files**, against a `docs/` tree of 23,380,362 B at
baseline (**+18.5%**). No Git LFS and no other storage mechanism was introduced.

**Custody of the originals** is unchanged and is recorded per archive in §2 by SHA-256 and absolute
path: `/mnt/d/Taylor_Parts/Claude Design Docs/` (read-only to this lane; nothing was written, moved
or deleted there), and additionally in the program bundle at `/home/rudy2/.local/share/eos-bundles/`.
Any recovered copy can be re-verified against its archive with the SHA-256 pairs in §2 and §3.

### 6.2 The 123 entries already present by content
Not re-committed. Every one is listed in `RECOVERY-MANIFEST.json` under `already_in_repo_by_content`,
with its SHA-256 and the repository path that already holds those exact bytes — including the seven
package READMEs vendored under `DESIGN-HANDOFF-*.md` names and the five `.dc.html` renamed on
vendoring. Nothing was skipped silently.

### 6.3 Nothing was overwritten
No file outside `docs/design-history/recovered/` and `docs/design/archaeology/` was modified. Where a
recovered artifact shares a filename with a repository file whose bytes differ, the recovered copy
was written to its archive-keyed path under `docs/design-history/recovered/` and the divergence
recorded in §7. **No repository artifact was replaced by an archive copy.**

---

## 7. Findings

### F1 — `Scoping answers needed P1.zip` settles both open archaeology questions. The files are still gone; the **enumeration is now proven.**

Register §8 listed two UNPROVEN items and named `HTML Site Scoping answers needed.zip` as the only
thing that could settle them. That zip is **not** in this custody. But
`Scoping answers needed P1.zip` — delivered the same day, 2026-08-25 — contains
`design_handoff_work_order/pilot-menu.js`, a navigation component whose `LINKS` table **indexes the
entire pilot corpus by filename**. It is a delivered manifest, not a reconstruction.

**The five `1–5 * Before-After.dc.html` filenames — UNPROVEN → PROVEN:**

1. `1 - Account Before-After.dc.html`
2. `2 - Opportunity Before-After.dc.html`
3. `3 - Sales Order Before-After.dc.html`
4. `4 - Work Order Before-After.dc.html`
5. `5 - Parts Before-After.dc.html`

The count of **5** is confirmed, and the five surfaces the lost pilot audited — which register §3.1
noted *"are not enumerated at that line"* — are now named: **Account, Opportunity, Sales Order, Work
Order, Parts.**

**The `Current - *.dc.html` membership — UNPROVEN → PROVEN. It is six, not "roughly four":**

1. `Current - Account Detail.dc.html`
2. `Current - Opportunities.dc.html`
3. `Current - Sales Order.dc.html`
4. `Current - Work Order.dc.html`
5. `Current - Parts List.dc.html`
6. `Current - Part Detail.dc.html`

Register §3.6 inferred *"a residue of roughly **4** unnamed files"* from the 27-HTML-file total at
`eos-north-star-sources.md:237`. **The residue arithmetic was wrong, and so, therefore, is the
27-file total or the assumption that the menu and the package had the same membership.** The
component indexes **36 distinct filenames**. The register's instruction *"do not publish a number"*
was the right call on the evidence it had; the number is now 6, on delivered evidence.

**The full pilot corpus, now enumerable — and the scale of what is still missing.** Of the 36
filenames the component indexes, **2 are recovered** (`North Star - Work Order.dc.html`,
`Proposed - Work Order.dc.html`). **34 remain unavailable**, now by name rather than by class. This
includes all 15 §3 artifacts whose existence the register could only infer from prose citations —
every one appears in the delivered index, which independently corroborates that the register's names
were accurate.

**What is still lost here, stated plainly.** The **severity-graded audit of the then-current
surfaces** — register §3.6's central loss — is **not recovered.** We now know there were six
`Current - *` recreations and five `Before-After` comparisons, and their exact names. We do not have
one of the eleven files, and no scoring rubric was recovered. Register recommendation **R9** stands
in full.

### F2 — The brief named three load-bearing recoveries. There are four.

Register §3.2 row **4**, `Implementation Render - Work Order.html`, is the **second** artifact
DECISIONS #123 names — *"the explicit pixel target"* — and the brief's table omitted it. It is
recovered, from `Scoping answers needed P1v2.zip`. Register §5.2's framing (*"it is worse than
stated — the acceptance rests on two unavailable artifacts, not one"*) is exactly why this matters:
the closed Family-1 acceptance is auditable only if **both** are available. Both now are.

### F3 — A closed Owner acceptance the archaeology set never classified: My Dashboard.

`Sales and Inventory Dashboards North Star P1v2.zip` yields three `.dc.html` persona canvases and ten
1440/375 frames for **My Dashboard** — a surface whose acceptance is recorded as **CLOSED / OWNER
ACCEPTED 2026-09-03** (P3-A3 §6.3), correctives live-verified 2026-09-04. **No archaeology lane
classified these artifacts, because the repository held the handoff document and the lanes read the
family as current.** The handoff itself says otherwise, at
`docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md:605-607`:

> **Owner item:** if the P1v2 artboard should also be repo-resident as a `.dc.html` canvas alongside
> the other nine families, it needs to be exported and committed. This document does not stand in for
> the visual comp; it specifies composition, authority and states.

So a **second** closed Owner acceptance rested on visual authority absent from the repository, and it
was never flagged. The register's *"only closed acceptance resting on unavailable authority"* is
correct **within the register's own set** and incomplete as a statement about the programme.

**This is an open Owner item, and this lane did not close it.** The artboards are filed as recovered
historical evidence under `docs/design-history/recovered/`. Making them repo-resident *as the
family's visual authority* is the Owner decision `:605` asks for, and it is the controller's to
route — not a consequence of this recovery.

### F4 — `Implementation Render - Sales Order.html` exists, and DECISIONS #125 said no design artifact was in hand.

`Sales Order North Star P1v1.zip` (2026-08-25 22:54) contains
`design_handoff_sales_order/Implementation Render - Sales Order.html` — recovered here. DECISIONS
**#125** (2026-08-26, the following day) built Family 2 *"with **no Design artifact in hand**"* and
correctly set `AWAITING_OWNER_VISUAL_ACCEPTANCE`.

**Read this precisely.** The artifact register §3.3 row 7 declares never handed over is
`Proposed - Sales Order.dc.html`, and that artifact is **still unavailable** — it is one of the 34 in
F1. An *implementation render* is a render of what was built, not an approved design source. So #125
is **not** contradicted on its own terms. What changes is that the Sales Order family is no longer
entirely without a contemporaneous artifact. **Whether it is any kind of authority is an Owner
question**, and row 7's classification stands unchanged.

### F5 — Byte-divergence findings: three repository artifacts differ from the delivered originals.

Recovered under archive-keyed paths, never overwriting the repository copy.

| # | Filename | Delivered (archive) | Repository copy | Reading |
|---|---|---|---|---|
| **D1** | `North Star - Equipment P1v2.dc.html` | 32,718 B `3527a0dd…` — `Equipment North Star P1v2.zip` | 32,950 B `bf78f035…` at `docs/north-star/equipment/` | The repo copy is the revision shipped in `Equipment North Star P1v3.zip` (byte-identical to it). **One filename, two revisions**; the repo tracks the later one. Benign, but it means "`North Star - Equipment P1v2.dc.html`" does not uniquely identify a drawing |
| **D2** | `North Star - Financials 16 Reconciliation.dc.html` | 10,273 B `67864d64…` | **12,244 B** `38f00343…` | The repo copy is **1,971 B larger** than the delivered one |
| **D3** | `North Star - Financials 20 Governance.dc.html` | 12,022 B `4e1b2c40…` | **13,391 B** `11963cfe…` | The repo copy is **1,369 B larger** than the delivered one |

**D2 and D3 warrant attention.** 48 of the 50 Financials artifacts are byte-identical to the
delivery. Two canvases in the same package are not, and in both cases the repository copy is the
larger. That is the signature of **post-vendoring edits to a North Star canvas, or of a later
revision vendored under the same filename** — either way, two of the twenty Financials canvases in
`docs/north-star/financials/` are **not** the bytes that were delivered. This lane did not diff their
contents and draws no conclusion about which is authoritative; it records that they differ and that
nothing at baseline says so. **Routed to the controller.**

---

## 8. The residual — what is still genuinely unavailable

**This recovery does not resolve the archaeology set.** Of 25 SOURCE_UNAVAILABLE rows covering 29
named files, **6 rows / 9 files are recovered**. **19 rows remain SOURCE_UNAVAILABLE.**

| # | Still unavailable | Register row |
|---|---|---|
| 1 | `EOS UX Pilot.dc.html` | §3.1 r1 — name corroborated in the recovered index; no file |
| 2 | `North Star - Subpage Expansion.dc.html` | §3.1 r2 — same |
| 3 | `Proposed - Sales Order.dc.html` | §3.3 r7 |
| 4 | `Proposed - Account.dc.html` | §3.3 r8 |
| 5 | `Proposed - Account -Broadsheet-.dc.html` | §3.3 r9 |
| 6 | `Proposed - Opportunity.dc.html` | §3.3 r10 |
| 7 | `Proposed - Parts.dc.html` | §3.3 r11 |
| 8 | `Proposed - Dispatch Board.dc.html` | §3.3 r12 |
| 9 | `Proposed - Dispatch Map.html` | §3.3 r13 |
| 10 | `Proposed - Technician Mobile.dc.html` | §3.3 r14 — **still the highest-value gap**; the handheld has no design artifact |
| 11 | `Proposed - Warehouse Mobile.dc.html` | §3.3 r15 |
| 12 | `Proposed - Equipment.dc.html` | §3.3 r16 — fully dispositioned in a present frame; needs no follow-up |
| 13 | `Subpages - Commercial.dc.html` | §3.4 r17 |
| 14 | `Subpages - Operations.dc.html` | §3.4 r18 |
| 15 | `Subpages - Lists and States.dc.html` | §3.4 r19 — the 142-row density specimen |
| 16 | `parts-ux-redesign-blueprint.md` | §3.5 r22 |
| 17 | `audit-workspace-1440.png`, `audit-workspace-375.png`, `audit-record-1440.png`, `audit-record-375.png` | §3.5 r23 — 4 files; REGENERABLE for Atlas, not for re-auditing 2026-08-31 |
| 18 | `1 - Account Before-After.dc.html` … `5 - Parts Before-After.dc.html` | §3.6 r24 — 5 files, **now named** (F1) |
| 19 | `Current - Account Detail.dc.html`, `… Opportunities`, `… Sales Order`, `… Work Order`, `… Parts List`, `… Part Detail` | §3.6 r25 — **6 files, now named and counted** (F1) |

**Named-file arithmetic.** 29 named SOURCE_UNAVAILABLE files − 9 recovered = **20 still unavailable
by their original names**, plus **11 newly named** members of the two formerly open-ended classes =
**31 individual design artifacts still genuinely unavailable.** Against the pilot corpus the recovered
index enumerates, **34 of 36 filenames remain unavailable.**

**Nothing in the register's §4 changed.** The five BRANCH_ONLY / HISTORY_ONLY artifacts were never
lost and are unaffected by this recovery.

### 8.1 UNPROVEN after this recovery

| Item | Status | Blocker |
|---|---|---|
| Whether the shipped Work Order surface conforms to `North Star - Work Order.dc.html` + `Implementation Render - Work Order.html` | **UNPROVEN** | The artifacts now exist; **no one has run the comparison.** Recovery restored auditability, not conformance |
| Whether the shipped Parts workspace still conforms to frames `1a`/`1a-m`/`1b`/`1b-m` | **UNPROVEN** | Same, and harder: the surface has changed since `9848ec9d`, so a mismatch would not distinguish drift from a design change |
| Whether the Account surface conforms to `North Star - Account P1.dc.html` | **UNPROVEN** | Acceptance is still `AWAITING_OWNER_VISUAL_ACCEPTANCE`. There is no closed acceptance to audit against |
| Whether `docs/north-star/financials/North Star - Financials 16/20 …` or the delivered copies are authoritative | **UNPROVEN** | Findings D2/D3. Nothing at baseline records the divergence or which copy is intended |
| Whether the repo's `North Star - Equipment P1v2.dc.html` was meant to be the P1v3-archive revision | **UNPROVEN** | Finding D1. No document at baseline distinguishes the two revisions |
| Whether `eos-north-star-sources.md:237`'s **27 HTML files** is the right count for the delivered package | **UNPROVEN, and now doubted** | The recovered index names **36** files. Whether the package was a subset of the menu, the menu linked files never delivered, or 27 is simply wrong, cannot be settled from this custody |
| Whether the 31 still-unavailable artifacts survive anywhere else | **UNPROVEN** | `HTML Site Scoping answers needed.zip` is **not** in this custody. Register §8/R10 stands: external survival is plausible and worth pursuing. **This recovery is evidence that R10 was the right recommendation, not that it is complete** |
| Whether `eos-north-star-design-grammar.md` §8 is the whole lost AI continuity model | **UNPROVEN, unchanged** | `EOS UX Pilot.dc.html` and `North Star - Subpage Expansion.dc.html` are still unavailable |
| Whether `Implementation Render - Sales Order.html` has any authority status | **UNPROVEN** | Finding F4. An Owner question, not a documentary one |

---

## 9. Method and honesty note

The P3-ARCH absence finding was **correct about the repository and incomplete about the world.**
Every lane was correctly scoped to git refs; the register's §1 proved absence across 1,849 refs,
5,137 commits and 24,191 tree objects, reachable and unreachable, and stated its own limit exactly:
*"That is the limit of what git can prove. It does not prove the artifacts never existed."* Register
§8 went further and listed *"whether any lost artifact survives outside this repository (Downloads
folders, delivery zips …)"* as **UNPROVEN**, noting the corpus had been recovered from a
Downloads-folder zip once before, and recommended pursuing it (**R10**).

**The archives were outside every lane's authority to search.** No lane was wrong; the search
boundary was. This recovery executes R10 against one custody location and finds 9 of the 29 named
files. **It does not rewrite the register's history, and it does not make the register's method
wrong** — it confirms the register's own stated limit was real and its own recommendation was right.

Nothing in this manifest is reconstructed. Every recovered byte came from a delivered archive and was
verified by SHA-256 against the pre-existing census and again after writing, with zero defects. Where
a recovered artifact's relationship to a repository artifact is unclear, it is recorded as unclear.

> **RECOVERED HISTORICAL DESIGN EVIDENCE**
>
> **NOT:** current North Star · current implementation authority · permission to redesign ·
> **proof that current EOS still conforms.**
