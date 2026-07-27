import assert from "node:assert/strict";
import * as mod from "../src/domain/equipmentCompatibilityImport.js";
import { dryRunEquipmentCompatibilityImport, parseCsv, scanSensitive, IMPORT_PACKAGES, DEFAULT_LIMITS } from "../src/domain/equipmentCompatibilityImport.js";
let passed=0; const ok=(n,f)=>{f();passed++;console.log(`PASS -- ${n}`);};

const scheme={schemeId:"TAYLOR-ALPHA",manufacturerId:"Taylor",normalizerVersion:1,tokenPattern:"^[A-Z0-9-]+$",ordering:"LEXICOGRAPHIC"};
const CID="cmp_3d758a636765061e05842659c64bed910955c47e047851dc693d4aba19d4b252";
const FP="a".repeat(64);
const SNAP={partIds:["TST-1001","TST-2002"],equipmentModelIds:["TAYLOR--C713"],serialSchemes:{"TAYLOR-ALPHA":scheme},existingCompatibilityIds:[CID]};
const H=(pkg)=>IMPORT_PACKAGES[pkg].join(",");
// header + rows helper
const csv=(pkg,...rows)=>[H(pkg),...rows].join("\n");
const MODEL_OK="TAYLOR--C713,Taylor,Taylor,C713,Taylor C713,,,,ACTIVE,manufacturer,1";
const ALIAS_OK="SOURCE_MODEL,Taylor,C-713,TAYLOR--C713";
const COMPAT_OK="TAYLOR--C713,TST-1001,DIRECT_FIT,,,1,ALL_SERIALS,,,,,,,,HIGH,VERIFIED,,1";
const SRC_OK=`${CID},MANUFACTURER,Service Manual 12,,SUPPORTS,${FP},2026-07-27T07:06:24Z,admin-uid-1,`;
const run=(packages,snapshots=SNAP,limits={})=>dryRunEquipmentCompatibilityImport({packages,snapshots,limits});

// ---- module surface: dry-run only, no apply/write path ----
ok("no apply/execute/write export exists (dry-run only)",()=>{for(const k of Object.keys(mod)) assert.ok(!/apply|execute|commit|write|persist/i.test(k),`unexpected export: ${k}`);});
ok("report is always dry-run and non-applyable",()=>{const r=run({EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",COMPAT_OK)});assert.equal(r.dryRun,true);assert.equal(r.applyable,false);});

// ---- CSV parsing: bounds, headers, line endings, utf-8 ----
ok("valid parse yields records",()=>{const p=parseCsv(csv("EQUIPMENT_MODEL_ALIASES",ALIAS_OK),IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES);assert.equal(p.records.length,1);assert.equal(p.records[0].values.equipmentModelId,"TAYLOR--C713");});
ok("unknown/missing/duplicate header rejected",()=>{assert.equal(parseCsv("aliasType,manufacturerId,rawValue,equipmentModelId,extra\nx",IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).headerError,"header_mismatch");assert.equal(parseCsv("aliasType,manufacturerId,rawValue",IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).headerError,"header_mismatch");assert.equal(parseCsv("aliasType,aliasType,rawValue,equipmentModelId",IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).headerError,"duplicate_header");});
ok("BOM / invalid utf-8 / control chars rejected",()=>{assert.equal(parseCsv("﻿"+H("EQUIPMENT_MODEL_ALIASES"),IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).headerError,"bom_not_allowed");assert.equal(parseCsv(H("EQUIPMENT_MODEL_ALIASES")+"\n�",IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).headerError,"invalid_utf8");assert.equal(parseCsv(H("EQUIPMENT_MODEL_ALIASES")+"\n\x07",IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).headerError,"control_characters");});
ok("CR-only line ending rejected; CRLF normalized",()=>{assert.equal(parseCsv(H("EQUIPMENT_MODEL_ALIASES")+"\rrow",IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).headerError,"invalid_line_ending");const p=parseCsv(csv("EQUIPMENT_MODEL_ALIASES",ALIAS_OK).replace(/\n/g,"\r\n"),IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES);assert.equal(p.records.length,1);});
ok("file-size and row-count bounds enforced",()=>{assert.equal(parseCsv("x".repeat(50),IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES,{...DEFAULT_LIMITS,maxFileChars:10}).headerError,"file_too_large");const many=csv("EQUIPMENT_MODEL_ALIASES",...Array(5).fill(ALIAS_OK));assert.equal(parseCsv(many,IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES,{...DEFAULT_LIMITS,maxRows:3}).headerError,"too_many_rows");});
ok("column-count mismatch + field-too-long are row errors",()=>{const p=parseCsv(csv("EQUIPMENT_MODEL_ALIASES","SOURCE_MODEL,Taylor,C-713"),IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES);assert.equal(p.rowErrors[0].code,"column_count_mismatch");const q=parseCsv(csv("EQUIPMENT_MODEL_ALIASES",`SOURCE_MODEL,Taylor,${"C".repeat(40)},TAYLOR--C713`),IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES,{...DEFAULT_LIMITS,maxFieldChars:20});assert.equal(q.rowErrors[0].code,"field_too_long");});
ok("quoted fields keep embedded commas; unbalanced quote is an error",()=>{const p=parseCsv(csv("EQUIPMENT_PART_COMPATIBILITY",`TAYLOR--C713,TST-1001,DIRECT_FIT,"Main, Motor",,1,ALL_SERIALS,,,,,,,,HIGH,VERIFIED,,1`),IMPORT_PACKAGES.EQUIPMENT_PART_COMPATIBILITY);assert.equal(p.records[0].values.assembly,"Main, Motor");assert.equal(parseCsv(csv("EQUIPMENT_MODEL_ALIASES",'SOURCE_MODEL,Taylor,"C-713,TAYLOR--C713'),IMPORT_PACKAGES.EQUIPMENT_MODEL_ALIASES).rowErrors[0].code,"unbalanced_quote");});

// ---- per-row validation surfaced with sanitized line + code ----
ok("invalid rows surfaced with line + code (no raw values)",()=>{const r=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER","TAYLOR--C713,Taylor,Taylor,C713,Taylor C713,,,,BOGUS,manufacturer,1")});const e=r.errors.find(x=>x.package==="EQUIPMENT_MASTER");assert.equal(e.line,2);assert.equal(e.code,"status_invalid");assert.equal(e.field,null);});
ok("noncanonical/invented model id in master is rejected, not coerced",()=>{const r=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER","taylor--c713,Taylor,Taylor,C713,Taylor C713,,,,ACTIVE,manufacturer,1")});assert.ok(r.errors.some(e=>e.code==="id_invalid"));});

// ---- reference resolution against explicit snapshots ----
ok("unresolved partId and equipmentModelId are visible errors",()=>{const r=run({EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY","TAYLOR--C999,TST-9999,DIRECT_FIT,,,1,ALL_SERIALS,,,,,,,,HIGH,VERIFIED,,1")});const codes=r.unresolved.map(u=>u.code).sort();assert.deepEqual(codes,["equipment_model_unresolved","part_unresolved"]);assert.equal(r.status,"BLOCKED");});
ok("in-batch master resolves compatibility model ref",()=>{const r=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER",MODEL_OK),EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",COMPAT_OK)},{...SNAP,equipmentModelIds:[]});assert.equal(r.unresolved.length,0);});
ok("aliases cannot create models — unresolved when model absent",()=>{const r=run({EQUIPMENT_MODEL_ALIASES:csv("EQUIPMENT_MODEL_ALIASES","SOURCE_MODEL,Taylor,C-999,TAYLOR--C999")});assert.ok(r.unresolved.some(u=>u.package==="EQUIPMENT_MODEL_ALIASES"&&u.code==="equipment_model_unresolved"));});
ok("unresolved source compatibilityId is visible",()=>{const other="cmp_"+"0".repeat(64);const r=run({COMPATIBILITY_SOURCES:csv("COMPATIBILITY_SOURCES",`${other},MANUFACTURER,Ref,,SUPPORTS,${FP},2026-07-27T07:06:24Z,admin-uid-1,`)});assert.ok(r.unresolved.some(u=>u.code==="compatibility_unresolved"));});

// ---- duplicate / collision / alias-conflict ----
ok("model duplicate (idempotent) vs collision",()=>{const dup=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER",MODEL_OK,MODEL_OK)});assert.equal(dup.collisions.equipmentModels.length,0);assert.equal(dup.duplicatesIdempotent.equipmentModels,1);const col=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER",MODEL_OK,"TAYLOR--C713,Taylor,Taylor,C713,DIFFERENT NAME,,,,ACTIVE,manufacturer,1")});assert.equal(col.collisions.equipmentModels.length,1);assert.deepEqual(col.collisions.equipmentModels[0].lines,[2,3]);assert.equal(col.status,"BLOCKED");});
ok("compatibility collision (same id, different content)",()=>{const r=run({EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",COMPAT_OK,"TAYLOR--C713,TST-1001,DIRECT_FIT,,,1,ALL_SERIALS,,,,,,,,LOW,VERIFIED,,1")});assert.equal(r.collisions.compatibility.length,1);assert.equal(r.status,"BLOCKED");});
ok("alias cross-owner conflict surfaced",()=>{const r=run({EQUIPMENT_MODEL_ALIASES:csv("EQUIPMENT_MODEL_ALIASES","SOURCE_MODEL,Taylor,C-713,TAYLOR--C713","SOURCE_MODEL,Taylor,C-713,TAYLOR--C825")},{...SNAP,equipmentModelIds:["TAYLOR--C713","TAYLOR--C825"]});assert.equal(r.collisions.modelAliasConflicts.length,1);assert.equal(r.status,"BLOCKED");});

// ---- precedence + evidence conflict (reseller/WO stay non-authoritative via D2) ----
ok("contradicting evidence → REVIEW_REQUIRED with visible conflict, never auto-verified",()=>{const r=run({COMPATIBILITY_SOURCES:csv("COMPATIBILITY_SOURCES",SRC_OK,`${CID},RESELLER,Listing,,CONTRADICTS,${"c".repeat(64)},2026-07-27T07:06:24Z,admin-uid-1,`)});assert.equal(r.status,"REVIEW_REQUIRED");assert.equal(r.conflicts.length,1);assert.equal(r.conflicts[0].compatibilityId,CID);assert.equal(r.conflicts[0].strongestSupport,"MANUFACTURER");assert.equal(r.conflicts[0].strongestContradiction,"RESELLER");});
ok("source collision (changed claim, same source identity)",()=>{const r=run({COMPATIBILITY_SOURCES:csv("COMPATIBILITY_SOURCES",SRC_OK,`${CID},MANUFACTURER,Service Manual 12,,CONTRADICTS,${FP},2026-07-27T07:06:24Z,admin-uid-1,`)});assert.equal(r.collisions.sources.length,1);assert.equal(r.status,"BLOCKED");});

// ---- market listings quarantine ----
ok("market listings are quarantined, counted, never authoritative or staged",()=>{const r=run({MARKET_LISTINGS:csv("MARKET_LISTINGS","L1,ebay,Taylor,C713,TST-1001,http://x,2026-07-27T00:00:00Z")});assert.equal(r.quarantine.marketListings,1);assert.equal(r.quarantine.authoritative,false);assert.equal(r.counts.quarantinedMarketListings,1);assert.ok(!r.staged||r.staged.compatibilityIds.length===0);});

// ---- sensitive-data scanning + report sanitization ----
ok("sensitive scan flags secrets/PII by line+code, never the value",()=>{const secretNote=`TAYLOR--C713,TST-1001,DIRECT_FIT,,,1,ALL_SERIALS,,,,,,,,HIGH,VERIFIED,contact admin@example.com bearer sk_live_ABC,1`;const r=run({EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",secretNote)});assert.equal(r.sensitive.clean,false);const codes=r.sensitive.findings.map(f=>f.code);assert.ok(codes.includes("email"));assert.ok(codes.includes("credential_keyword"));const blob=JSON.stringify(r);assert.ok(!blob.includes("admin@example.com"));assert.ok(!blob.includes("sk_live_ABC"));});
ok("report never reproduces raw row values (notes/serials)",()=>{const note="ULTRASECRETNOTE";const serial="ZZ-SECRET-9999";const row=`TAYLOR--C713,TST-1001,DIRECT_FIT,,,1,SERIAL_RANGE,TAYLOR-ALPHA,${serial},,,,,,HIGH,IN_REVIEW,${note},1`;const r=run({EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",row)});const blob=JSON.stringify(r);assert.ok(!blob.includes(note));assert.ok(!blob.includes(serial));});
ok("standalone scanSensitive returns line+code only",()=>{const f=scanSensitive("ok line\nsecret=hunter2 here","P");assert.equal(f.length,1);assert.deepEqual(f[0],{package:"P",line:2,code:"credential_keyword"});});

// ---- no partial apply / zero-write / determinism ----
ok("no partial apply: any blocking error empties the staged plan",()=>{const r=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER",MODEL_OK),EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",COMPAT_OK,"TAYLOR--C713,TST-9999,DIRECT_FIT,,,1,ALL_SERIALS,,,,,,,,HIGH,VERIFIED,,1")});assert.equal(r.status,"BLOCKED");assert.equal(r.staged,null);});
ok("clean batch stages opaque ids only (no raw values)",()=>{const r=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER",MODEL_OK),EQUIPMENT_MODEL_ALIASES:csv("EQUIPMENT_MODEL_ALIASES",ALIAS_OK),EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",COMPAT_OK),COMPATIBILITY_SOURCES:csv("COMPATIBILITY_SOURCES",SRC_OK)});assert.equal(r.status,"READY");assert.deepEqual(r.staged.equipmentModelIds,["TAYLOR--C713"]);assert.deepEqual(r.staged.compatibilityIds,[CID]);assert.match(r.staged.sourceIds[0],/^src_[0-9a-f]{64}$/);});
ok("inputs are read-only (not mutated by dry run)",()=>{const packages=Object.freeze({EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",COMPAT_OK)});const snapshots=SNAP;const before=JSON.stringify(snapshots);run(packages);assert.equal(JSON.stringify(snapshots),before);});
ok("deterministic replay: same input → deep-equal report",()=>{const packages={EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER",MODEL_OK,"TAYLOR--C825,Taylor,Taylor,C825,Taylor C825,,,,ACTIVE,manufacturer,1"),EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",COMPAT_OK),COMPATIBILITY_SOURCES:csv("COMPATIBILITY_SOURCES",SRC_OK)};const a=run(packages),b=run(packages);assert.deepEqual(a,b);});
ok("output ordering is deterministic (sorted errors)",()=>{const r=run({EQUIPMENT_MASTER:csv("EQUIPMENT_MASTER","TAYLOR--C713,Taylor,Taylor,C713,N,,,,BOGUS,manufacturer,1","taylor--c825,Taylor,Taylor,C825,N,,,,ACTIVE,manufacturer,1")});const lines=r.errors.map(e=>e.line);assert.deepEqual([...lines].sort((x,y)=>x-y),lines);});
ok("error refs are bounded with truncation count",()=>{const rows=Array.from({length:6},()=> "TAYLOR--C713,TST-1001,BADTYPE,,,1,ALL_SERIALS,,,,,,,,HIGH,VERIFIED,,1");const r=run({EQUIPMENT_PART_COMPATIBILITY:csv("EQUIPMENT_PART_COMPATIBILITY",...rows)},SNAP,{maxErrorRefs:3});assert.equal(r.errors.length,3);assert.equal(r.errorsTruncated,3);});

console.log(`\n${passed} passed`);
