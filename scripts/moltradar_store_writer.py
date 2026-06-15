#!/usr/bin/env python3
"""
MoltRadar store writer.
Scheduled sidecar (6h). Resolves ERC-8004-identified prediction-market wallets to operators
and writes radar_store.json, served by the MoltGuard Hono layer under /radar/*.

NOTE: identifiedWallets counts ERC-8004-identified wallets in a market, NOT total holders.
A single-operator flag is operator *concentration among identified wallets* — a neutral,
disclosed fact about wallet control, not an accusation of manipulation.

Input : active_wallets.json {active:{wallet:value}, op_of:{wallet:operator}}
Output: radar_store.json
"""
import json,urllib.request,concurrent.futures as cf,datetime as dt
from collections import defaultdict

# junk / non-operator addresses to exclude from clustering
DENYLIST = {
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
}

def get(u):
    try: return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"Mozilla/5.0"}),timeout=12))
    except: return []
def positions(a):
    d=get(f"https://data-api.polymarket.com/positions?user={a}"); return a,(d if isinstance(d,list) else [])

def build(active_path="active_wallets.json", out="radar_store.json", min_wallets=5):
    A=json.load(open(active_path)); active=list(A["active"]); op_of=A["op_of"]
    today=dt.date.today()
    mkt=defaultdict(lambda:defaultdict(lambda:{"wallets":set(),"net":0.0,"val":0.0,"q":"","slug":"","end":""}))
    with cf.ThreadPoolExecutor(max_workers=16) as ex:
        for a,plist in ex.map(positions,active):
            o=op_of.get(a,a)
            if o.lower() in DENYLIST or a.lower() in DENYLIST: continue
            for p in plist:
                red=p.get("redeemable"); end=(p.get("endDate") or "")[:10]
                fut=False
                try: fut=dt.date.fromisoformat(end)>=today
                except: pass
                if not ((red is False) or (red is None and fut)): continue
                cid=p.get("conditionId")
                if not cid: continue
                out_=(p.get("outcome") or "").lower(); sz=float(p.get("size") or 0)
                signed=sz if out_ in("yes","up","over") else -sz if out_ in("no","down","under") else sz
                c=mkt[cid][o]; c["wallets"].add(a); c["net"]+=signed; c["val"]+=float(p.get("currentValue") or 0)
                c["q"]=p.get("title","") or c["q"]; c["slug"]=p.get("slug","") or c["slug"]; c["end"]=end or c["end"]
    markets={}
    for cid,ops in mkt.items():
        identified=sum(len(c["wallets"]) for c in ops.values())
        oplist=[]
        for o,c in sorted(ops.items(),key=lambda x:-len(x[1]["wallets"])):
            oplist.append({"operator":o,"identitySource":"erc8004:polygon:owner",
                           "walletCount":len(c["wallets"]),"wallets":sorted(c["wallets"]),
                           "netDirection":"YES" if c["net"]>=0 else "NO","netSize":round(c["net"],1),
                           "valueUsd":round(c["val"],2)})
        dom=oplist[0]; any_c=next(iter(ops.values()))
        markets[cid]={
            "conditionId":cid,"question":any_c["q"][:140],"slug":any_c["slug"],"endDate":any_c["end"],
            "identifiedWallets":identified,"distinctOperators":len(ops),
            "concentration":round(dom["walletCount"]/identified,3) if identified else 0,
            "dominantOperator":dom["operator"],"dominantWallets":dom["walletCount"],
            "netDirection":dom["netDirection"],"netSize":dom["netSize"],"currentValueUsd":dom["valueUsd"],
            "flag":"SINGLE_OPERATOR" if len(ops)==1 else "MULTI_OPERATOR",  # threshold is a feed-cut, not part of the flag
            "operators":oplist}
    so=[m["conditionId"] for m in sorted(markets.values(),key=lambda m:-m["identifiedWallets"]) if m["flag"]=="SINGLE_OPERATOR"]
    store={"generated":dt.datetime.now(dt.timezone.utc).isoformat(),
           "source":"erc8004-polygon + polymarket-data-api",
           "note":"identifiedWallets = ERC-8004-identified wallets in market, not total holders",
           "counts":{"markets":len(markets),"single_operator":len(so)},
           "single_operator":so,"markets":markets}
    json.dump(store,open(out,"w"),indent=1)
    print(f"radar_store.json: {len(markets)} markets, {len(so)} single-operator")
    return store

if __name__=="__main__": build()
