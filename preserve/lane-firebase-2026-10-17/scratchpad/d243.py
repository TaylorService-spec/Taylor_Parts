from ed import edit
p = "D:/eos-fb-exit/docs/DECISIONS.md"
s = open(p, encoding="utf-8", newline="").read()
i = s.index("## #243")
anchor = "  - Admin and owner hold `customer.record.read`. **No customer-read grant is added** to compensate."
j = s.index(anchor, i)
k = s.index("\n", j + len(anchor))
add = "\n  - **Administration projects it.** `crmActivity` is declared in the governed Object catalog (`capabilityGovernedObjects.json`): no fields and **no CRED verb**. A derived R cell would overstate the read, which also needs `customer.record.read`. Administration lists the Object and shows both capabilities under it. The contributor Role is assigned only through the governed preview → assignRole path."
nl = "\r\n" if "\r\n" in s else "\n"
s = s[:k] + add.replace("\n", nl) + s[k:]
open(p, "w", encoding="utf-8", newline="").write(s)
