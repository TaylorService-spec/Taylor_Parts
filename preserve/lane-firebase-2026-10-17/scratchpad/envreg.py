import subprocess
p = "D:/eos-lanes/ENV-REGISTRY.md"
s = open(p, encoding="utf-8", newline="").read()
old = "| idle 2026-10-17: no processes and :55507 NOT running (verified with ps/ss). #2128 pushed; remote CI is the gate. Next: the Firebase-exit slice plan (no local runs) |"
ts = subprocess.run(["bash", "-c", "TZ=America/Phoenix date '+%Y-%m-%d %H:%M %z'"], capture_output=True, text=True).stdout.strip()
new = f"| RELEASED {ts} (America/Phoenix): #2133 / #2134 / #2135 merged (main ee596ec3); PG stopped, :55507 not listening, no process with cwd under ~/fbx (verified). Data dir and clone kept. Historical Firebase copy tooling Owner-held. |"
assert s.count(old) == 1
open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new))
print(new)
