import assert from "node:assert/strict";
import { buildEquipmentModelId, detectModelAliasConflicts, isCanonicalEquipmentModelId, normalizeEquipmentModel, normalizeIdentityText, normalizeModelAliasKey, normalizeSerialToken, validateEquipmentModel, validateEquipmentModelAlias, validateSerialRange, validateSerialScheme } from "../src/domain/equipmentModel.js";
let passed=0; const ok=(n,f)=>{f();passed++;console.log(`PASS -- ${n}`);};
const scheme={schemeId:"TAYLOR.ALPHA",manufacturerId:"Taylor",normalizerVersion:1,tokenPattern:"^[A-Z0-9-]+$",ordering:"LEXICOGRAPHIC"};
// Canonical Equipment Model IDs used as conflict fixtures.
const ID0="TAYLOR--C713", IDA="TAYLOR--C713-REV-A", IDB="TAYLOR--C713-REV-B";
const NONCANONICAL=["A","B","taylor--c713"," TAYLOR--C713","TAYLOR--C713 ","TAYLOR--","--C713","TAYLOR---C713","TAYLOR--C713--X","TAYLOR--C713É","TAYLOR__C713","",42,null,{}];
const mkAlias=(raw,id)=>({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:raw,equipmentModelId:id});
const model=(over)=>({manufacturerId:"Taylor",manufacturerName:"Taylor",modelNumber:"C713",displayName:"Taylor C713",status:"ACTIVE",sourceAuthority:"mfr",version:1,...over});
ok("Unicode/space normalization",()=>assert.equal(normalizeIdentityText(" Model  Ａ "),"Model A"));
ok("deterministic model id",()=>assert.equal(buildEquipmentModelId("Taylor Company"," C713-33 "),"TAYLOR-COMPANY--C713-33"));
ok("normalization is non-mutating",()=>{const i={manufacturerId:"Taylor",modelNumber:" c713 ",family:""};const b=structuredClone(i);assert.equal(normalizeEquipmentModel(i).family,null);assert.deepEqual(i,b);});
// --- canonical equipment model id contract (shared) ---
ok("canonical id validator: accepts canonical",()=>{for(const v of [ID0,IDA,IDB,"AB12--XY9","TAYLOR-COMPANY--C713-33"]) assert.equal(isCanonicalEquipmentModelId(v),true);});
ok("canonical id validator: rejects noncanonical/arbitrary",()=>{for(const v of NONCANONICAL) assert.equal(isCanonicalEquipmentModelId(v),false,`expected reject: ${String(v)}`);});
ok("valid strict model",()=>assert.equal(validateEquipmentModel(model({equipmentModelId:ID0,family:null,subtype:null,revision:null,status:"active",sourceAuthority:"manufacturer"})).valid,true));
ok("mismatched id denied",()=>assert.equal(validateEquipmentModel(model({equipmentModelId:"OTHER"})).reason,"id_invalid"));
ok("model rejects noncanonical stored id (no silent normalize)",()=>{assert.equal(validateEquipmentModel(model({equipmentModelId:"TAYLOR--C713 "})).reason,"id_invalid");assert.equal(validateEquipmentModel(model({equipmentModelId:"taylor--c713"})).reason,"id_invalid");});
ok("unknown field denied",()=>assert.equal(validateEquipmentModel({manufacturerId:"Taylor",modelNumber:"C713",secret:"x"}).reason,"unknown_field"));
ok("alias identity scoped",()=>assert.equal(normalizeModelAliasKey({aliasType:"source_model",manufacturerId:"Taylor",rawValue:" c-713 "}),"SOURCE_MODEL|TAYLOR|C-713"));
// --- alias record contract (strict, pure) ---
ok("alias contract: valid + derived key",()=>{const r=validateEquipmentModelAlias({aliasType:"source_model",manufacturerId:"Taylor",rawValue:" c-713 ",equipmentModelId:ID0});assert.equal(r.valid,true);assert.equal(r.value.aliasKey,"SOURCE_MODEL|TAYLOR|C-713");assert.equal(r.value.equipmentModelId,ID0);});
ok("alias contract: not_object",()=>{assert.equal(validateEquipmentModelAlias(null).reason,"not_object");assert.equal(validateEquipmentModelAlias("x").reason,"not_object");assert.equal(validateEquipmentModelAlias([]).reason,"not_object");});
ok("alias contract: unknown_field",()=>assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:ID0,note:"x"}).reason,"unknown_field"));
ok("alias contract: alias_type_invalid",()=>assert.equal(validateEquipmentModelAlias({aliasType:"NOPE",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:ID0}).reason,"alias_type_invalid"));
ok("alias contract: missing identity denied",()=>{assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"  ",rawValue:"C713",equipmentModelId:ID0}).reason,"manufacturer_id_invalid");assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"   ",equipmentModelId:ID0}).reason,"alias_value_invalid");});
ok("alias contract: noncanonical equipmentModelId denied",()=>{for(const id of NONCANONICAL) assert.equal(validateEquipmentModelAlias(mkAlias("C713",id)).reason,"equipment_model_id_invalid",`expected reject id: ${String(id)}`);assert.equal(validateEquipmentModelAlias(mkAlias("C713",IDA)).valid,true);});
ok("alias contract: document-key agreement",()=>{assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:ID0,aliasKey:"SOURCE_MODEL|TAYLOR|C713"}).valid,true);assert.equal(validateEquipmentModelAlias({aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:ID0,aliasKey:"WRONG"}).reason,"alias_key_mismatch");});
// --- conflict analysis (fail-visible, structured) ---
ok("duplicate same-owner aliases remain clean",()=>{const r=detectModelAliasConflicts([mkAlias("C713",ID0),{aliasType:"source_model",manufacturerId:"taylor",rawValue:" c713 ",equipmentModelId:ID0}]);assert.deepEqual(r.conflicts,[]);assert.deepEqual(r.invalid,[]);});
ok("cross-owner alias conflict visible",()=>{const r=detectModelAliasConflicts([mkAlias("C713",IDA),mkAlias("C713",IDB)]);assert.equal(r.conflicts.length,1);assert.deepEqual(r.conflicts[0].equipmentModelIds,[IDA,IDB]);assert.deepEqual(r.invalid,[]);});
ok("3+ owners remain complete and sorted",()=>{const r=detectModelAliasConflicts([mkAlias("C713",IDB),mkAlias("C713",ID0),mkAlias("C713",IDA)]);assert.equal(r.conflicts.length,1);assert.deepEqual(r.conflicts[0].equipmentModelIds,[ID0,IDA,IDB]);assert.deepEqual(r.invalid,[]);});
ok("malformed aliases make analysis non-clean (surfaced, not thrown)",()=>{const r=detectModelAliasConflicts([null,undefined,"x",42,[],{aliasType:"BOGUS",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:ID0},mkAlias("C713","A"),{aliasType:"SOURCE_MODEL",manufacturerId:"Taylor",rawValue:"C713",equipmentModelId:ID0,secret:"x"}]);assert.deepEqual(r.conflicts,[]);assert.deepEqual(r.invalid.map(e=>e.reason),["not_object","not_object","not_object","not_object","not_object","alias_type_invalid","equipment_model_id_invalid","unknown_field"]);assert.deepEqual(r.invalid.map(e=>e.index),[0,1,2,3,4,5,6,7]);});
ok("malformed model IDs cannot hide a genuine conflict",()=>{const r=detectModelAliasConflicts([mkAlias("C713",IDA),mkAlias("C713","A"),mkAlias("C713",IDB)]);assert.equal(r.conflicts.length,1);assert.deepEqual(r.conflicts[0].equipmentModelIds,[IDA,IDB]);assert.deepEqual(r.invalid,[{index:1,reason:"equipment_model_id_invalid"}]);});
ok("non-array input is fail-closed non-clean",()=>{const r=detectModelAliasConflicts("nope");assert.deepEqual(r.conflicts,[]);assert.equal(r.invalid.length,1);assert.equal(r.invalid[0].reason,"not_array");});
// --- deterministic, locale-independent ordering (code-unit, not localeCompare/numeric) ---
ok("conflict member ordering is code-unit deterministic",()=>{const r=detectModelAliasConflicts([mkAlias("C713","TAYLOR--C2"),mkAlias("C713","TAYLOR--C10"),mkAlias("C713","TAYLOR--C1")]);assert.deepEqual(r.conflicts[0].equipmentModelIds,["TAYLOR--C1","TAYLOR--C10","TAYLOR--C2"]);});
ok("conflict list ordering is code-unit deterministic",()=>{const r=detectModelAliasConflicts([mkAlias("C2",IDA),mkAlias("C2",IDB),mkAlias("C10",IDA),mkAlias("C10",IDB)]);assert.deepEqual(r.conflicts.map(c=>c.aliasKey),["SOURCE_MODEL|TAYLOR|C10","SOURCE_MODEL|TAYLOR|C2"]);});
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
