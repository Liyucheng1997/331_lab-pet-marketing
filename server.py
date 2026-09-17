"""PetOps Italia — local-only application, Python 3.11+, no server dependencies."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import os, json, sqlite3, uuid, datetime as dt, mimetypes, urllib.parse, base64, io, csv, zipfile, threading
import engine
import progress
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('PETOPS_DATA', ROOT / 'data'))
DATA.mkdir(parents=True, exist_ok=True)
DB = DATA / 'petops.sqlite3'
PLATFORMS = ['Amazon', 'TikTok Shop', 'AliExpress', 'Zooplus', 'Arcaplanet']
SELLERS = PLATFORMS[:3]
MUTATION = threading.RLock()
JOBS = None

def config():
    return next(iter(records('settings')),engine.DEFAULTS.copy())

def get_product(pid):
    p=next((p for p in records('products') if p['id']==pid),None)
    if not p: raise ValueError('商品不存在')
    return p

def file_path(rel):
    f=(DATA/rel).resolve()
    if not f.is_relative_to(DATA.resolve()) or not f.is_file(): raise ValueError('文件不存在')
    return f

@contextmanager
def connect():
    c = sqlite3.connect(DB, timeout=20)
    c.row_factory = sqlite3.Row
    try:
        with c: yield c
    finally: c.close()

def init():
    with connect() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, sku TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, body TEXT NOT NULL);
        ''')

def records(table):
    with connect() as c:
        return [json.loads(r['body']) for r in c.execute(f'SELECT body FROM {table} ORDER BY rowid DESC')]

def save(table, obj):
    with connect() as c:
        if table == 'products':
            c.execute('INSERT INTO products VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,body=excluded.body', (obj['id'],obj['sku'],json.dumps(obj,ensure_ascii=False)))
        else:
            c.execute(f'INSERT INTO {table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', (obj['id'],json.dumps(obj,ensure_ascii=False)))

def state():
    products=records('products');s=config()
    for p in products:
        p['pricing']=engine.pricing(p,s)
        p['assets']=engine.assets(p,DATA)
        p['barcodeCheck']=engine.barcode_status(p.get('ean'))
        if not p.get('researchStatus') and p.get('researchedAt') and not p.get('offers'):
            p['researchStatus']='needs_info' if engine.placeholder_name(p.get('nameZh')) or not p.get('nameZh') else 'no_quotes'
    jobs=records('jobs')
    for job in jobs:job['progress']=progress.describe(job,DATA)
    return {'products':products, 'jobs':jobs, 'sales':records('sales'), 'platforms':PLATFORMS,'settings':s,'capabilities':engine.capabilities()}

def mutate(path,d):
    if path=='/api/products':
        old=get_product(d['id']) if d.get('id') else None
        if old and str(d.get('sku',old['sku'])).strip()!=old['sku']: raise ValueError('已建档 SKU 不可更改，以保留完整销售历史；请新建商品')
        p=engine.product(d,old)
        save('products',p);return p
    if path=='/api/select':
        for pid in d['ids']:
            p=get_product(pid);p['selected']=bool(d['selected']);save('products',p)
        return {'ok':True}
    if path=='/api/schedule':
        chosen=engine.plan(records('products'),d['ids'],d['start'],d['capacity'],bool(d.get('weekends')))
        for p in chosen: save('products',p)
        return {'count':len(chosen)}
    if path=='/api/unschedule':
        p=get_product(d['id']);p['scheduledDate']=None;save('products',p);return p
    if path=='/api/offer':
        p=get_product(d['id']);p['offers'].append(engine.offer(d));save('products',p);return p
    if path=='/api/remove-offer':
        p=get_product(d['id']);p['offers']=[o for o in p['offers'] if o['id']!=d['offerId']];save('products',p);return p
    if path=='/api/upload':
        p=get_product(d['id'])
        if d['platform'] not in SELLERS: raise ValueError('平台无效')
        if not p.get('assetsReady') or not p.get('assetReview'): raise ValueError('请先在创作工坊检查并确认完成的图片')
        p['uploaded'][d['platform']]=bool(d['done']);p['uploadUpdatedAt']=engine.now();save('products',p);return p
    if path=='/api/review':
        p=get_product(d['id'])
        if not p.get('assetsReady'): raise ValueError('尚未生成完整图片')
        p['assetReview']=bool(d['approved']);save('products',p);return p
    if path=='/api/settings':
        s=engine.settings(d);save('settings',s);return s
    if path=='/api/sales':
        r=engine.sale(d,records('products'));save('sales',r);return r
    if path=='/api/delete-sale':
        with connect() as c: c.execute('DELETE FROM sales WHERE id=?',(d['id'],))
        return {'ok':True}
    if path=='/api/import':
        if d.get('kind') not in ['products','sales']: raise ValueError('导入类型无效')
        rows=d.get('rows',[])
        if not isinstance(rows,list) or len(rows)>5000: raise ValueError('单次最多导入 5000 条')
        existing=records('products');pending=[]
        # Validate all rows before committing; never partially import a bad batch.
        for row in rows:
            old=next((p for p in existing if p['sku']==str(row.get('sku','')).strip()),None)
            pending.append(engine.sale(row,existing) if d['kind']=='sales' else engine.product(row,old))
        if d['kind']!='sales' and len({p['sku'] for p in pending})!=len(pending): raise ValueError('导入文件有重复 SKU')
        if d['kind']=='sales' and len({p['id'] for p in pending})!=len(pending): raise ValueError('导入文件有重复销售记录 ID')
        with connect() as c:
            for p in pending:
                if d['kind']=='sales': c.execute('INSERT INTO sales VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',(p['id'],json.dumps(p,ensure_ascii=False)))
                else: c.execute('INSERT INTO products VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,body=excluded.body',(p['id'],p['sku'],json.dumps(p,ensure_ascii=False)))
        return {'count':len(pending)}
    if path=='/api/reference':
        p=get_product(d['id'])
        raw=base64.b64decode(d['data'],validate=True)
        if len(raw)>15*1024*1024: raise ValueError('参考图最大 15MB')
        if raw.startswith(b'\x89PNG\r\n\x1a\n'): ext='.png'
        elif raw.startswith(b'\xff\xd8\xff'): ext='.jpg'
        elif raw[:4]==b'RIFF' and raw[8:12]==b'WEBP': ext='.webp'
        else: raise ValueError('仅支持 PNG、JPEG、WebP 图片')
        folder=DATA/'references';folder.mkdir(exist_ok=True)
        f=folder/(uuid.uuid4().hex+ext);f.write_bytes(raw)
        p['reference']=str(f.relative_to(DATA)).replace('\\','/');p['cover']='/files/'+p['reference'];save('products',p);return p
    if path=='/api/adopt-edit':
        p=get_product(d['id'])
        j=next((j for j in records('jobs') if j['id']==d['jobId'] and j['productId']==p['id'] and j['kind']=='edit' and j['status']=='completed'),None)
        if not j or not j.get('edited'): raise ValueError('找不到可采用的修改图')
        file_path(j['edited'])
        source=next((a for a in engine.assets(p,DATA) if a['path']==j['asset']),None)
        if not source: raise ValueError('原素材已换版本，请基于当前素材重新修改')
        p.setdefault('assetOverrides',{})[source['originalPath']]=j['edited'].replace('\\','/')
        p['assetReview']=False
        save('products',p);return p
    if path=='/api/jobs': return JOBS.submit(get_product(d['id']),d['kind'],d.get('extra',''),d.get('asset',''))
    raise ValueError('未知操作')

def csv_bytes(rows,fields):
    stream=io.StringIO();writer=csv.DictWriter(stream,fields,extrasaction='ignore');writer.writeheader()
    for row in rows:
        safe={k:(' '+str(v) if isinstance(v,str) and v.startswith(('=','+','-','@')) else v) for k,v in row.items()}
        writer.writerow(safe)
    return ('\ufeff'+stream.getvalue()).encode('utf-8')

def bundle(p):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
        for platform,doc in engine.listing_docs(p,config()).items(): z.writestr(platform.replace(' ','_')+'/listing_it.md',doc)
        items=engine.assets(p,DATA)
        for item in items:
            f=file_path(item['path'])
            z.write(f,'assets/'+item['group']+'/'+item['name'])
            targets=SELLERS if item['scope']=='通用' else ['TikTok Shop'] if 'TikTok' in item['scope'] else ['AliExpress'] if item['group']=='detail' else ['Amazon','AliExpress']
            for target in targets: z.write(f,target.replace(' ','_')+'/images/'+item['group']+'/'+item['name'])
        z.writestr('image_assignment.json',json.dumps(items,ensure_ascii=False,indent=2))
        z.writestr('README.txt','图片分配是工作建议，非平台审核通过保证。Amazon 主图使用 01_main_white，通用图复用，AliExpress 使用 detail 模块。TikTok 方图可用于商品展示；短视频/竖版宣传图须另行制作。上架前检查各平台当日类目规则。所有商品事实以实物为准。')
    return buffer.getvalue()

class Handler(BaseHTTPRequestHandler):
    def send(self, value, status=200, content_type='application/json; charset=utf-8'):
        payload = json.dumps(value,ensure_ascii=False).encode() if isinstance(value,(dict,list)) else value
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.headers.get('Host') not in ['127.0.0.1:3310','localhost:3310']: return self.send({'error':'仅允许本机访问'},403)
        try:
            parsed=urllib.parse.urlparse(self.path);path=urllib.parse.unquote(parsed.path);q=urllib.parse.parse_qs(parsed.query)
            if path=='/api/state': return self.send(state())
            if path=='/api/export':
                kind=q.get('kind',['products'])[0]
                fields={'products':['sku','nameZh','nameIt','ean','brand','category','cost','stock','dimensions','weight','material','descriptionZh','descriptionIt'], 'sales':['id','date','sku','platform','units','revenue','vatAmount','cogs','fees','shipping','ads','refunds','profit']}
                if kind=='research':
                    rows=[dict(o,sku=p['sku'],nameZh=p.get('nameZh',''),nameIt=p.get('nameIt','')) for p in records('products') for o in p.get('offers',[])]
                    cols=['sku','nameZh','nameIt','platform','price','currency','sold','period','match','url','checkedAt','source']
                else: rows=records(kind) if kind in fields else [];cols=fields.get(kind,fields['products'])
                return self.send(csv_bytes(rows,cols),content_type='text/csv; charset=utf-8')
            if path=='/api/bundle': return self.send(bundle(get_product(q['id'][0])),content_type='application/zip')
            if path=='/api/backup':
                out=io.BytesIO()
                with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
                    z.writestr('records.json',json.dumps(state(),ensure_ascii=False,indent=2))
                    for f in DATA.rglob('*'):
                        if f.is_file() and f.suffix in ['.png','.jpg','.webp','.md','.json','.txt']: z.write(f,str(f.relative_to(DATA)))
                return self.send(out.getvalue(),content_type='application/zip')
            if path.startswith('/files/'):
                file=file_path(path[7:])
                if file.suffix.lower() not in ['.png','.jpg','.jpeg','.webp','.json','.jsonl','.txt','.md']: raise ValueError('禁止下载此类型文件')
                return self.send(file.read_bytes(),content_type=(mimetypes.guess_type(file)[0] if file.suffix.lower() in ['.png','.jpg','.jpeg','.webp'] else 'text/plain; charset=utf-8'))
            file=(ROOT/'web'/('index.html' if path=='/' else path.lstrip('/'))).resolve()
            if not file.is_relative_to(ROOT/'web') or not file.is_file(): return self.send({'error':'不存在'},404)
            self.send(file.read_bytes(),content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
        except (ValueError,KeyError) as e: self.send({'error':str(e)},400)

    def do_POST(self):
        origin=self.headers.get('Origin')
        if self.headers.get('Host') not in ['127.0.0.1:3310','localhost:3310'] or (origin and origin not in ['http://127.0.0.1:3310','http://localhost:3310']): return self.send({'error':'仅允许本机同源请求'},403)
        if not self.headers.get('Content-Type','').startswith('application/json'): return self.send({'error':'需要 JSON 请求'},415)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<1 or size>22*1024*1024: raise ValueError('请求大小无效')
            data=json.loads(self.rfile.read(size))
            with MUTATION: result=mutate(self.path,data)
            self.send(result)
        except sqlite3.IntegrityError: self.send({'error':'SKU 已存在，请编辑现有商品'},409)
        except (ValueError,KeyError,TypeError) as e: self.send({'error':str(e)},400)
        except Exception as e:
            print(type(e).__name__,str(e),flush=True);self.send({'error':'操作失败，请查看本机服务日志'},500)

if __name__ == '__main__':
    init()
    JOBS=engine.Jobs(DATA,records,save,config,MUTATION)
    print('PetOps Italia running at http://127.0.0.1:3310',flush=True)
    ThreadingHTTPServer(('127.0.0.1',3310),Handler).serve_forever()
