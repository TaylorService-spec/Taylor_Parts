import fs from "node:fs"; import path from "node:path";
const root = "D:/eos-fb-exit";
// parse ids from the client gate files by regex over quoted dotted ids
const gateFiles = ["field-ops-app-vite/src/access/shellCapabilityGates.js","field-ops-app-vite/src/access/governedSurfaceCapabilities.js","field-ops-app-vite/src/access/reportAccess.js"];
const idRe = /"([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g;
const ids = new Set();
for (const f of gateFiles) { const t = fs.readFileSync(path.join(root,f),"utf8").split("\n").filter(l=>!/^\s*(\/\/|\*)/.test(l)).join("\n"); for (const m of t.matchAll(idRe)) ids.add(m[1]); }
for (const x of ["opportunity.read","salesOrder.read","finance.read","crm.activity.read"]) ids.add(x);
// remove obvious non-capability strings
const list=[...ids].filter(i=>!/^(inventoryRole|administration)\./.test(i));
// EOS corpus: migrations + seed json + adminPolicy deltas
let corpus="";
const walk=(d,exts,acc)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()){ if(e.name==="node_modules"||e.name==="lib") continue; walk(p,exts,acc);} else if(exts.some(x=>e.name.endsWith(x))) acc.push(p);}};
const mig=[]; walk(path.join(root,"functions/migrations"),[".sql"],mig);
const migText=mig.map(f=>fs.readFileSync(f,"utf8")).join("\n");
const baseline=fs.readFileSync(path.join(root,"functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"),"utf8");
const snap=fs.readFileSync(path.join(root,"functions/src/adminPolicy/seed/policySeedSnapshot.json"),"utf8");
const adm=[]; walk(path.join(root,"functions/src/adminPolicy"),[".ts"],adm);
const admText=adm.map(f=>fs.readFileSync(f,"utf8")).join("\n");
const fbCat=fs.readFileSync(path.join(root,"functions/src/access/permissionCatalog.ts"),"utf8");
const out=[];
for (const id of list.sort()) {
  const inMig = migText.includes(`'${id}'`)||migText.includes(`"${id}"`);
  const inBase = baseline.includes(`"${id}"`);
  const inSnap = snap.includes(`"${id}"`);
  const inAdmTs = admText.includes(`"${id}"`)||admText.includes(`'${id}'`);
  const inFb = fbCat.includes(`"${id}"`)||fbCat.includes(`'${id}'`);
  out.push([id, inFb?"FB":"--", inMig?"MIG":"---", inBase?"BASE":"----", inSnap?"SNAP":"----", inAdmTs?"ADMTS":"-----"].join("\t"));
}
console.log(out.join("\n"));
console.log("count",list.length);
