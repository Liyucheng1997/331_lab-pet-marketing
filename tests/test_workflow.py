import sys, tempfile, unittest, json, io, zipfile, datetime as dt, threading, http.client
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server, engine

class Workflow(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old=(server.DATA,server.DB)
        server.DATA=Path(self.temp.name);server.DB=server.DATA/'test.sqlite3';server.init()

    def tearDown(self):
        server.DATA,server.DB=self.old
        self.temp.cleanup()

    def add(self,sku='PET-001',**kw):
        return server.mutate('/api/products',dict(sku=sku,nameZh='猫窝',nameIt='Cuccia per gatti',cost=10,stock=50,**kw))

    def test_persistence_pricing_unknowns(self):
        p=self.add();read=server.state()['products'][0]
        self.assertEqual(read['sku'],p['sku'])
        for result in read['pricing'].values():
            self.assertGreater(result['price'],10)
            self.assertAlmostEqual(result['margin'],25,places=1)
            self.assertIsNone(result['market'])
        empty=engine.product({'sku':'UNKNOWN','ean':'1234567890123'})
        self.assertIsNone(engine.pricing(empty,engine.DEFAULTS)['Amazon']['price'])
        self.assertEqual(read['offers'],[])

    def test_atomic_import_duplicate_and_invalid(self):
        self.add()
        with self.assertRaises(ValueError):server.mutate('/api/import',{'kind':'products','rows':[{'sku':'SECOND','nameZh':'狗碗'},{'sku':'BAD','cost':-10}]})
        self.assertEqual(len(server.records('products')),1)
        with self.assertRaises(ValueError):server.mutate('/api/import',{'kind':'products','rows':[{'sku':'X','nameZh':'碗'},{'sku':'X','nameZh':'碗'}]})
        self.assertEqual(len(server.records('products')),1)

    def test_schedule_capacity_weekend_collision(self):
        ps=[self.add(f'SKU-{i}') for i in range(8)]
        # Friday capacity three, skip weekend; account for three existing jobs.
        server.mutate('/api/schedule',{'ids':[p['id'] for p in ps[:3]],'start':'2026-09-18','capacity':3})
        server.mutate('/api/schedule',{'ids':[p['id'] for p in ps[3:]],'start':'2026-09-18','capacity':3})
        counts={}
        for p in server.records('products'):
            self.assertLess(dt.date.fromisoformat(p['scheduledDate']).weekday(),5)
            counts[p['scheduledDate']]=counts.get(p['scheduledDate'],0)+1
        self.assertEqual(counts,{'2026-09-22':2,'2026-09-21':3,'2026-09-18':3})
        with self.assertRaises(ValueError):engine.plan(ps,[ps[0]['id']],'2026-09-18',3.5)

    def test_offer_provenance_and_unknown_sales(self):
        p=self.add()
        d={'id':p['id'],'platform':'Amazon','url':'https://www.amazon.it/dp/B012345678','price':20,'match':'exact'}
        server.mutate('/api/offer',d)
        o=server.get_product(p['id'])['offers'][0]
        self.assertIsNone(o['sold']);self.assertEqual(o['source'],'manual')
        with self.assertRaises(ValueError):engine.offer(dict(d,url='https://amazon.it.evil.example/dp/X'))
        with self.assertRaises(ValueError):engine.offer(dict(d,sold=40))

    def test_sales_profit_idempotency(self):
        self.add()
        d={'id':'ORDER-1','sku':'PET-001','platform':'Amazon','date':'2026-09-17','units':2,'revenue':100,'vatAmount':18,'cogs':20,'fees':15,'shipping':8,'ads':4,'refunds':5}
        r=server.mutate('/api/sales',d);self.assertEqual(r['profit'],30)
        server.mutate('/api/sales',d);self.assertEqual(len(server.records('sales')),1)
        with self.assertRaises(ValueError):engine.sale(dict(d,id="bad' onclick='alert(1)"),server.records('products'))

    def test_export_and_status_gate(self):
        p=self.add()
        with self.assertRaises(ValueError):server.mutate('/api/upload',{'id':p['id'],'platform':'Amazon','done':True})
        with zipfile.ZipFile(io.BytesIO(server.bundle(p))) as z:
            self.assertTrue(all(x.replace(' ','_')+'/listing_it.md' in z.namelist() for x in engine.SELLERS))
            self.assertIn('DA VERIFICARE',z.read('Amazon/listing_it.md').decode())
        csv=server.csv_bytes([{'sku':'=CMD()'}],['sku']).decode('utf-8-sig')
        self.assertIn(' =CMD()',csv)
        with self.assertRaises(ValueError):server.file_path('../server.py')

    def test_fees_invalid_and_sales_units(self):
        with self.assertRaises(ValueError):engine.settings({'targetMargin':80,'fees':{'Amazon':60}})
        p=self.add()
        with self.assertRaises(ValueError):engine.sale({'sku':p['sku'],'date':'2026-09-17','platform':'Amazon','units':1.5},[p])

    def test_http_api_origin_and_roundtrip(self):
        httpd=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        client=http.client.HTTPConnection('127.0.0.1',httpd.server_port)
        headers={'Host':'127.0.0.1:3310','Content-Type':'application/json','Origin':'http://127.0.0.1:3310'}
        try:
            client.request('POST','/api/products',json.dumps({'sku':'HTTP-01','nameZh':'猫碗'}),headers)
            r=client.getresponse();self.assertEqual(r.status,200);p=json.loads(r.read())
            client.request('GET','/api/state',headers={'Host':'127.0.0.1:3310'})
            r=client.getresponse();self.assertEqual(json.loads(r.read())['products'][0]['id'],p['id'])
            client.request('POST','/api/select',json.dumps({'ids':[p['id']],'selected':True}),dict(headers,Origin='https://untrusted.example'))
            r=client.getresponse();self.assertEqual(r.status,403);r.read()
            self.assertFalse(server.get_product(p['id'])['selected'])
            client.request('GET','/api/bundle?id='+p['id'],headers={'Host':'127.0.0.1:3310'})
            r=client.getresponse();self.assertEqual(r.status,200)
            with zipfile.ZipFile(io.BytesIO(r.read())) as z:self.assertEqual(len([n for n in z.namelist() if n.endswith('.md')]),3)
        finally:
            client.close();httpd.shutdown();httpd.server_close();thread.join()

    def test_job_completion_preserves_manual_changes(self):
        p=self.add();baseline=dict(p);result=dict(p,nameIt='AI generated title',advice='New advice')
        manual=dict(p,nameIt='Human title',cost=15);server.save('products',manual)
        jobs=engine.Jobs(server.DATA,server.records,server.save,server.config,server.MUTATION)
        jobs.save_product_result(result,baseline)
        latest=server.get_product(p['id'])
        self.assertEqual(latest['nameIt'],'Human title');self.assertEqual(latest['cost'],15)
        self.assertEqual(latest['advice'],'New advice')

if __name__=='__main__': unittest.main(verbosity=2)
