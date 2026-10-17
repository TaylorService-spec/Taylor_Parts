from ed import edit
edit("D:/eos-fb-exit/functions/test/coordinatedVisitObjectRehome.test.mjs", [
("""  // financialPolicy (#232). Pinned as the exact key list, so a registration is a named change here, never a silent count.""",
 """  // financialPolicy (#232); then inventoryReturn (#242, Firebase exit F7a) and crmActivity (#243, F7b) -- 51. Pinned as the
  // exact key list, so a registration is a named change here, never a silent count."""),
("""    "account", "auditLog", "commissions", "contact", "cycleCount",""", """    "account", "auditLog", "commissions", "contact", "crmActivity", "cycleCount","""),
("""    "financeConfiguration", "financialPolicy", "inboundMailbox", "inboundWorkRequest", "inventoryAction", "inventoryTransaction",""",
 """    "financeConfiguration", "financialPolicy", "inboundMailbox", "inboundWorkRequest", "inventoryAction", "inventoryReturn", "inventoryTransaction","""),
])
