from ed import edit
edit("functions/test/experienceAuthority.test.mjs", [
("""      "dashboard/operationsDashboard",
      "inventory/parts",
      "inventory/receiving",""",
"""      "dashboard/operationsDashboard",
      // Manufacturers R-1 Option A (Firebase exit F5): the door is `inventory.catalog`, the surface the list's
      // inventory.catalog.read earns. The LIST also needs inventory.manufacturer.read (DECISIONS #241).
      "inventory/manufacturers",
      "inventory/parts",
      "inventory/receiving","""),
("""      "dashboard/operationsDashboard",
      "inventory/parts",
      "inventory/reorderQueue",""",
"""      "dashboard/operationsDashboard",
      "inventory/manufacturers",
      "inventory/parts",
      "inventory/reorderQueue","""),
])
