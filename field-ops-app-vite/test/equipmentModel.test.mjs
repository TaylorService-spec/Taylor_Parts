import assert from "node:assert/strict";
import { buildEquipmentModelId, detectModelAliasConflicts, normalizeEquipmentModel, normalizeIdentityText, normalizeModelAliasKey, normalizeSerialToken, validateEquipmentModel, validateEquipmentModelAlias, validateSerialRange, validateSerialScheme } from "../src/domain/equipmentModel.js";
let passed=0; const ok=(n,f)=>{f();passed++;console.log(`PASS -- ${n}`);};
const scheme={schemeId:"TAYLOR.ALPHA",manufacturerId:"Taylor",normalizerVersion:1,tokenPattern:"^[A-Z0-9-]+$",ordering:"LEXICOGRAPHIC"};
const mkAlias=(raw,id)=>({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:raw,equipmentModelId:id});
ok("Unicode/space normalization",()=>assert.equal(normalizeIdentityText(" Model  Ａ "),"Model A"));
ok("deterministic model id",()=>assert.equal(buildEquipmentModelId("Taylor Company"," C713-33 "),"TAYLOR-COMPANY--C713-33"));
ok("normalization is non-mutating",()=>{const i={manufacturerId:"Taylor",modelNumber:" c713 ",family:""};const b=structuredClone(i);assert.equal(normalizeEquipmentModel(i).family,null);assert.deepEqual(i,b);});
ok("valid strict model",()=>assert.equal(validateEquipmentModel({equipmentModelId:"TAYLOR--C713",manufacturerId:"Taylor",manufacturerName:"Taylor",modelNumber:"C713",displayName:"Taylor C713",family:null,subtype:null,revision:null,status:"active",sourceAuthority:"manufacturer",version:1}).valid,true));
ok("mismatched id denied",()=>assert.equal(validateEquipmentModel({equipmentModelId:"OTHER",manufacturerId:"Taylor",manufacturerName:"Taylor",modelNumber:"C713",displayName:"Taylor C713",status:"ACTIVE",sourceAuthority:"mfr",version:1}).reason,"id_invalid"));
ok("unknown field denied",()=>assert.equal(validateEquipmentModel({manufacturerId:"Taylor",modelNumber:"C713",secret:"x"}).reason,"unknown_field"));
ok("alias identity scoped",()=>assert.equal(normalizeModelAliasKey({aliasType:"source_model",manufacturerId:"Taylor",rawValue:" c-713 "}),"SOURCE_MODEL|TAYLOR|C-713"));
// --- alias record contract (strict, pure) ---
ok("alias contract: valid + derived key",()=>{const r=validateEquipmentModelAlias({aliasType:"source_model",manufacturerId:"Taylor",rawValue:" c-713 ",equipmentModelId:"TAYLOR--C713"});assert.equal(r.valid,true);assert.equal(r.value.aliasKey,"SOURCE_MODEL|TAYLOR|C-713");});
ok("alias contract: not_object",()=>{assert.equal(validateEquipmentModelAlias(null).reason,"not_object");assert.equal(validateEquipmentModelAlias("x").reason,"not_object");assert.equal(validateEquipmentModelAlias([]).reason,"not_object");});
ok("alias contract: unknown_field",()=>assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"A",note:"x"}).reason,"unknown_field"));
ok("alias contract: alias_type_invalid",()=>assert.equal(validateEquipmentModelAlias({aliasType:"NOPE",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"A"}).reason,"alias_type_invalid"));
ok("alias contract: missing identity denied",()=>{assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"  ",rawValue:"C713",equipmentModelId:"A"}).reason,"manufacturer_id_invalid");assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"   ",equipmentModelId:"A"}).reason,"alias_value_invalid");assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"  "}).reason,"equipment_model_id_invalid");});
ok("alias contract: document-key agreement",()=>{assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"A",aliasKey:"SOURCE_MODEL|TAYLOR|C713"}).valid,true);assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"A",aliasKey:"WRONG"}).reason,"alias_key_mismatch");});
// --- conflict analysis (fail-visible, structured) ---
ok("duplicate same-owner aliases remain clean",()=>{const r=detectModelAliasConflicts([{aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"TAYLOR--C713"},{aliasType:"source_model",manufacturerId:"taylor",rawValue:" c713 ",equipmentModelId:"TAYLOR--C713"}]);assert.deepEqual(r.conflicts,[]);assert.deepEqual(r.invalid,[]);});
ok("cross-owner alias conflict visible",()=>{const r=detectModelAliasConflicts([mkAlias("C713","A"),mkAlias("C713","B")]);assert.equal(r.conflicts.length,1);assert.deepEqual(r.conflicts[0].equipmentModelIds,["A","B"]);assert.deepEqual(r.invalid,[]);});
ok("3+ owners remain complete and sorted",()=>{const r=detectModelAliasConflicts([mkAlias("C713","C"),mkAlias("C713","A"),mkAlias("C713","B")]);assert.equal(r.conflicts.length,1);assert.deepEqual(r.conflicts[0].equipmentModelIds,["A","B","C"]);assert.deepEqual(r.invalid,[]);});
ok("malformed aliases make analysis non-clean (surfaced, not thrown)",()=>{const r=detectModelAliasConflicts([null,undefined,"x",42,[],{aliasType:"BOGUS",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"A"},{aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:"A",secret:"x"}]);assert.deepEqual(r.conflicts,[]);assert.deepEqual(r.invalid.map(e=>e.reason),["not_object","not_object","not_object","not_object","not_object","alias_type_invalid","unknown_field"]);assert.deepEqual(r.invalid.map(e=>e.index),[0,1,2,3,4,5,6]);});
ok("malformed input cannot hide a valid A/B conflict",()=>{const r=detectModelAliasConflicts([mkAlias("C713","A"),null,mkAlias("C713","B")]);assert.equal(r.conflicts.length,1);assert.deepEqual(r.conflicts[0].equipmentModelIds,["A","B"]);assert.deepEqual(r.invalid,[{index:1,reason:"not_object"}]);});
ok("non-array input is fail-closed non-clean",()=>{const r=detectModelAliasConflicts("nope");assert.deepEqual(r.conflicts,[]);assert.equal(r.invalid.length,1);assert.equal(r.invalid[0].reason,"not_array");});
// --- deterministic, locale-independent ordering (code-unit, not localeCompare/numeric) ---
ok("conflict member ordering is code-unit deterministic",()=>{const r=detectModelAliasConflicts([mkAlias("C713","A2"),mkAlias("C713","A10"),mkAlias("C713","A1")]);assert.deepEqual(r.conflicts[0].equipmentModelIds,["A1","A10","A2"]);});
ok("conflict list ordering is code-unit deterministic",()=>{const r=detectModelAliasConflicts([mkAlias("C2","A"),mkAlias("C2","B"),mkAlias("C10","A"),mkAlias("C10","B")]);assert.deepEqual(r.conflicts.map(c=>c.aliasKey),["SOURCE_MODEL|TAYLOR|C10","SOURCE_MODEL|TAYLOR|C2"]);});
ok("serial range ordering is code-unit not numeric",()=>{assert.equal(validateSerialRange({start:"A9",end:"A10",scheme}).reason,"range_reversed");assert.equal(validateSerialRange({start:"A10",end:"A9",scheme}).valid,true);});
// --- serial scheme + token/range contracts ---
ok("serial scheme valid",()=>assert.equal(validateSerialScheme(scheme).valid,true));
ok("bad regex denied",()=>assert.equal(validateSerialScheme({...scheme,tokenPattern:"["}).valid,false));
ok("ordering must be explicit",()=>assert.equal(validateSerialScheme({...scheme,ordering:"NUMERIC"}).reason,"ordering_invalid"));
ok("alphanumeric serial preserved",()=>assert.equal(normalizeSerialToken(" ab-019 ",scheme),"AB-019"));
ok("open range valid",()=>assert.equal(validateSerialRange({start:"A100",end:null,scheme}).valid,true));
ok("reversed range denied",()=>assert.equal(validateSerialRange({start:"Z900",end:"A100",scheme}).reason,"range_reversed"));
ok("empty range denied",()=>assert.equal(validateSerialRange({start:null,end:null,scheme}).reason,"empty_range"));
console.log(`\n${passed} passed`);
