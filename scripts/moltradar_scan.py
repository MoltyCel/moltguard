#!/usr/bin/env python3
"""
MoltRadar scanner — produces active_wallets.json (the missing pipeline front-half).
Cron chain (6h):  moltradar_scan.py  ->  active_wallets.json
                  moltradar_store_writer.py  ->  radar_store.json  (served by Hono /radar/*)

Sweeps the ERC-8004 IdentityRegistry (Polygon), keeps prediction-market agents, resolves each
to its operational Polymarket wallet(s) + owner (operator), validates real trading activity,
and writes {active:{wallet:value}, op_of:{wallet:operator}}.
"""
import json,urllib.request,base64,gzip,re,time,urllib.parse,concurrent.futures as cf
UA={"Content-Type":"application/json","User-Agent":"Mozilla/5.0"}
RPCS=["https://polygon-bor-rpc.publicnode.com","https://polygon.drpc.org"]
REG="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
OWNEROF="0x6352211e"; TOKENURI="0xc87b56dd"
KW=("polymarket","kalshi","prediction market","prediction","forecast","polystrat","predly","myriad","limitless")
INFRA={REG.lower(),"0x4d97dcd97ec945f40cf65f87097ace5ea0476045","0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
 "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e","0xc5d563a36ae78145c45a50134d48a1215220f80a",
 "0xd91e80cf2e7be2e162c6513ced06f1dd0da35296","0x4777f95d99dbce724155048942600771770ff98d"}
DENYLIST={"0x0000000000000000000000000000000000000000","0x000000000000000000000000000000000000dead"}
ADDR_RE=re.compile(r"0x[0-9a-fA-F]{40}")

def rpc():
    for u in RPCS:
        try:
            urllib.request.urlopen(urllib.request.Request(u,data=json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}).encode(),headers=UA),timeout=15); return u
        except: pass
    raise SystemExit("no RPC")
URL=rpc()
def u(n): return hex(n)[2:].rjust(64,"0")
def batch(calls):
    p=[{"jsonrpc":"2.0","id":i,"method":"eth_call","params":[{"to":REG,"data":d},"latest"]} for i,d in calls]
    for _ in range(3):
        try: return {x["id"]:x.get("result") for x in json.load(urllib.request.urlopen(urllib.request.Request(URL,data=json.dumps(p).encode(),headers=UA),timeout=40))}
        except: time.sleep(2)
    return {}
def dstr(h):
    try:
        b=bytes.fromhex(h[2:]); ln=int.from_bytes(b[32:64],"big"); return b[64:64+ln].decode("utf-8","replace")
    except: return ""
def fetch(uri):
    try:
        if uri.startswith("data:"):
            m,_,p=uri.partition(","); raw=base64.b64decode(p) if "base64" in m else urllib.parse.unquote(p).encode()
            return (gzip.decompress(raw) if "gzip" in m else raw).decode("utf-8","replace")
        if uri.startswith("ipfs://"): uri="https://ipfs.io/ipfs/"+uri[7:]
        if uri.startswith("http"): return urllib.request.urlopen(urllib.request.Request(uri,headers={"User-Agent":"Mozilla/5.0"}),timeout=7).read().decode("utf-8","replace")
    except: return ""
    return ""
def maxid():
    def ex(t):
        r=batch([(0,OWNEROF+u(t))]).get(0); return bool(r) and r!="0x" and int(r,16)!=0
    hi=1
    while ex(hi) and hi<1<<24: hi*=2
    a,b=hi//2,hi
    while a<b:
        m=(a+b+1)//2; a,b=(m,b) if ex(m) else (a,m-1)
    return a
def api_value(a):
    try:
        d=json.load(urllib.request.urlopen(urllib.request.Request(f"https://data-api.polymarket.com/value?user={a}",headers={"User-Agent":"Mozilla/5.0"}),timeout=10))
        return a,(d[0]["value"] if isinstance(d,list) and d else 0)
    except: return a,0

def main(out="active_wallets.json"):
    N=maxid(); ids=list(range(N+1)); print(f"[1] registry ~{N+1} agents")
    owner={}; uri={}
    for s in range(0,len(ids),40):
        c=ids[s:s+40]
        o=batch([(i,OWNEROF+u(i)) for i in c]); t=batch([(i,TOKENURI+u(i)) for i in c])
        for i in c:
            r=o.get(i); owner[i]=("0x"+r[-40:]).lower() if r and r!="0x" else None; uri[i]=dstr(t.get(i))
    # prediction-market agents -> candidate operational wallets
    cand=set(); cand_owner={}
    nflag=0
    for i in ids:
        if not owner[i]: continue
        doc=fetch(uri.get(i,""))
        if not any(k in doc.lower() for k in KW): continue
        nflag+=1
        for w in set(a.lower() for a in ADDR_RE.findall(doc))-INFRA-DENYLIST-{owner[i]}:
            cand.add(w); cand_owner[w]=owner[i]
        if owner[i] not in DENYLIST: cand.add(owner[i]); cand_owner.setdefault(owner[i],owner[i])
    print(f"[2] prediction-market agents={nflag}, candidate wallets={len(cand)}")
    # validate real Polymarket activity
    active={}
    with cf.ThreadPoolExecutor(max_workers=16) as ex:
        for a,v in ex.map(api_value,sorted(cand)):
            if v: active[a]=v
    op_of={w:cand_owner.get(w,w) for w in active}
    print(f"[3] active wallets={len(active)}, distinct operators={len(set(op_of.values()))}")
    json.dump({"active":active,"op_of":op_of,"generated":time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},open(out,"w"))
    print(f"[4] wrote {out}")

if __name__=="__main__": main()
