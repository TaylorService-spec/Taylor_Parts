# usage: edit(path, [(old,new),...]) with \n in patterns; preserves CRLF
def edit(p, pairs, count=1):
    s=open(p,encoding="utf-8",newline="").read()
    crlf="\r\n" in s
    if crlf: s=s.replace("\r\n","\n")
    for a,b in pairs:
        c=s.count(a)
        assert c==count or (count is None and c>0),(p,a[:80],c)
        s=s.replace(a,b)
    if crlf: s=s.replace("\n","\r\n")
    open(p,"w",encoding="utf-8",newline="").write(s)
