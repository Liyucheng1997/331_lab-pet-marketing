"""Optional integration smoke test. Consumes local Codex quota; no inventory writes."""
import sys,time,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine
root=Path(__file__).resolve().parents[1]/'data'/'integration-check'
root.mkdir(parents=True,exist_ok=True)
store={'products':{},'jobs':{}}
def save(table,obj):
    store[table][obj['id']]=json.loads(json.dumps(obj))
    (root/(table+'.json')).write_text(json.dumps(list(store[table].values()),ensure_ascii=False,indent=2),encoding='utf-8')
p=engine.product({'sku':'INTEGRATION-KONG-M','nameZh':'KONG Classic 经典红色犬用橡胶玩具 M 号','nameIt':'KONG Classic M rosso','brand':'KONG','category':'狗玩具'})
save('products',p)
jobs=engine.Jobs(root,lambda t:list(store[t].values()),save,lambda:engine.DEFAULTS.copy())
j=jobs.submit(p,'research')
deadline=time.monotonic()+600
while time.monotonic()<deadline:
    current=store['jobs'][j['id']]
    if current['status'] not in ['queued','running']:
        print(json.dumps(current,ensure_ascii=False),flush=True)
        print('Offer count:',len(store['products'][p['id']]['offers']),flush=True)
        sys.exit(0 if current['status']=='completed' else 1)
    time.sleep(2)
print('Smoke test timeout; artifacts retained.',flush=True)
sys.exit(2)
