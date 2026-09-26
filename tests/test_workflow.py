import sys, tempfile, unittest, json, io, zipfile, base64
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server, engine


class Workflow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = (server.DATA, server.DB)
        server.DATA = Path(self.temp.name); server.DB = server.DATA / 'test.sqlite3'; server.init()

    def tearDown(self):
        server.DATA, server.DB = self.old
        self.temp.cleanup()

    def add(self, sku='PET-001', **kw):
        return server.mutate('/api/products', dict(dict(sku=sku, nameZh='猫窝', nameIt='Cuccia per gatti', stock=50, dimensions='45 × 35 × 15 cm', weight='850 g'), **kw))

    def fake_assets(self, p):
        root = server.DATA / 'runs' / 'job1'
        from PIL import Image
        for sub, names in [('listing', [f'0{i}_x.jpg' for i in range(1, 10)]), ('detail', [f'D{i}_x.png' for i in range(1, 10)])]:
            (root / sub).mkdir(parents=True, exist_ok=True)
            for n in names: Image.new('RGB', (1000, 1000), 'white').save(root / sub / n)
        (root / 'masters').mkdir(); Image.new('RGB', (30, 30)).save(root / 'masters' / 'M1_LISTING_PREVIEW_BOARD.png')
        p = server.get_product(p['id']); p.update(assetFolder='runs/job1', assetsReady=True); server.save('products', p)
        return p

    def test_product_validation_and_state(self):
        p = self.add()
        read = server.state()['products'][0]
        self.assertEqual(read['sku'], 'PET-001')
        self.assertEqual(set(read['listing']), set(engine.SELLERS))
        self.assertTrue(all(v['status'] == '待上架' for v in read['listing'].values()))
        with self.assertRaises(ValueError): engine.product({'sku': 'X'})
        with self.assertRaises(ValueError): engine.product({'sku': 'X', 'nameZh': 'a', 'ean': '12345'})
        with self.assertRaises(ValueError): engine.product({'sku': 'X', 'nameZh': 'a', 'stock': 1.5})
        # Partial update keeps untouched fields
        server.mutate('/api/products', {'id': p['id'], 'material': 'Peluche'})
        again = server.get_product(p['id'])
        self.assertEqual(again['material'], 'Peluche'); self.assertEqual(again['dimensions'], '45 × 35 × 15 cm')

    def test_v1_records_migrate_without_loss(self):
        old = {'id': 'a', 'sku': 'OLD', 'nameZh': '旧', 'reference': 'references/x.jpg', 'uploaded': {'Amazon': True, 'AliExpress': False, 'TikTok Shop': False}, 'offers': [{'price': 1}]}
        p = engine.migrate(old)
        self.assertEqual(p['references'], ['references/x.jpg'])
        self.assertEqual(p['listing']['Amazon']['status'], '已上架')
        self.assertEqual(p['listing']['AliExpress']['status'], '待上架')
        self.assertEqual(p['offers'], [{'price': 1}])

    def test_listing_update_rules(self):
        p = self.add()
        p = server.mutate('/api/listing', {'id': p['id'], 'platform': 'Amazon', 'fields': {'title': 'Cuccia', 'bullets': ['A', '', 'B'], 'price': '29.9', 'promoPrice': '24.9', 'status': '已上架'}})
        a = p['listing']['Amazon']
        self.assertEqual(a['bullets'], ['A', 'B']); self.assertEqual(a['price'], 29.9); self.assertTrue(a['listedAt'])
        for bad in [{'status': '随便'}, {'price': 10, 'promoPrice': 12}, {'url': 'http://x.it'}]:
            with self.assertRaises(ValueError): server.mutate('/api/listing', {'id': p['id'], 'platform': 'Amazon', 'fields': bad})
        with self.assertRaises(ValueError): server.mutate('/api/listing', {'id': p['id'], 'platform': 'eBay', 'fields': {}})

    def test_merge_copy_respects_limits_and_keeps_prices(self):
        p = self.add()
        p = engine.listing_update(p, 'AliExpress', {'price': 20, 'status': '草稿'})
        long_title = ' '.join(['Cuccia'] * 40)
        data = {'nameIt': 'Nuovo nome', 'descriptionIt': 'x', 'descriptionZh': 'y', 'toVerify': ['材质'],
                'aliexpress': {'title': long_title, 'titleZh': '猫窝', 'bullets': ['no'], 'description': 'D', 'keywords': 'k'},
                'amazon': {'title': 'T', 'titleZh': '', 'bullets': [f'B{i}' for i in range(8)], 'description': 'D', 'keywords': 'gatto ' * 80},
                'tiktok': {'title': 'T', 'titleZh': '', 'bullets': ['a'], 'description': 'D', 'keywords': 'x'}}
        merged, warnings = engine.merge_copy(p, data)
        ae = merged['listing']['AliExpress']
        self.assertLessEqual(len(ae['title']), 128); self.assertFalse(ae['title'].endswith(' '))
        self.assertEqual(ae['bullets'], []); self.assertEqual(ae['price'], 20); self.assertEqual(ae['status'], '草稿')
        self.assertEqual(len(merged['listing']['Amazon']['bullets']), 5)
        self.assertLessEqual(len(merged['listing']['Amazon']['keywords']), 250)
        self.assertEqual(merged['listing']['TikTok Shop']['keywords'], '')
        self.assertEqual(merged['nameIt'], 'Cuccia per gatti')  # existing name kept
        self.assertTrue(warnings)

    def test_package_listing_json_compatible(self):
        p = self.fake_assets(self.add())
        server.mutate('/api/listing', {'id': p['id'], 'platform': 'AliExpress', 'fields': {'title': 'Cuccia <morbida>', 'description': 'Uno\n\nDue', 'price': 19.99}})
        z = zipfile.ZipFile(io.BytesIO(server.bundle(server.get_product(p['id']))))
        j = json.loads(z.read('listing.json'))
        self.assertEqual(j['name_it'], 'Cuccia <morbida>')
        self.assertEqual(j['description_html'], '<p>Uno</p><p>Due</p>')
        self.assertEqual(j['images']['main_white_1x1'], 'images/listing/01_x.jpg')
        self.assertEqual(len(j['images']['gallery_1x1']), 7); self.assertEqual(len(j['images']['detail']), 9)
        self.assertEqual(j['logistics']['package_dimensions_cm'], [45.0, 35.0, 15.0]); self.assertEqual(j['logistics']['package_weight_g'], 850)
        self.assertEqual(j['pricing']['retail_price_eur'], 19.99)
        self.assertIn('copy_amazon.md', z.namelist()); self.assertIn('masters/M1_LISTING_PREVIEW_BOARD.png', z.namelist())

    def fake_v2_assets(self, p):
        root = server.DATA / 'runs' / 'v2'
        from PIL import Image
        names = {'main': [f'0{i}_x.jpg' for i in range(1, 7)], 'marketing': ['white_1x1.jpg', 'scene_3x4.jpg'],
                 'extra': ['07_selling_points.png', '08_variants.jpg'], 'detail': [f'D{i}_x.png' for i in range(1, 10)]}
        for sub, files in names.items():
            (root / sub).mkdir(parents=True, exist_ok=True)
            for n in files: Image.new('RGB', (900, 1200) if n.startswith('scene') else (1000, 1000), 'white').save(root / sub / n)
        (root / 'masters').mkdir()
        for n in engine.MASTERS: Image.new('RGB', (30, 30)).save(root / 'masters' / n)
        p = server.get_product(p['id']); p.update(assetFolder='runs/v2', assetsReady=True); server.save('products', p)
        return p

    def test_v2_asset_layout_and_package(self):
        p = self.fake_v2_assets(self.add(petModel='Barboncino toy albicocca'))
        read = server.state()['products'][0]
        self.assertEqual([a['group'] for a in read['assets']].count('main'), 6)
        self.assertEqual(read['assets'][0]['use'], '首图 · 正面全景')
        scene = next(a for a in read['assets'] if a['name'] == 'scene_3x4.jpg')
        self.assertEqual((scene['ratio'], scene['size']), ('3:4', '900×1200'))
        self.assertEqual(len(read['boards']), 3)
        self.assertEqual(read['petModel'], 'Barboncino toy albicocca')
        server.mutate('/api/listing', {'id': p['id'], 'platform': 'AliExpress', 'fields': {'attributes': 'Materiale: Acrilico' + chr(10) + 'Tipo di animale: Cane'}})
        j = json.loads(zipfile.ZipFile(io.BytesIO(server.bundle(server.get_product(p['id'])))).read('listing.json'))
        self.assertEqual(j['images']['main'][0], 'images/main/01_x.jpg'); self.assertEqual(len(j['images']['main']), 6)
        self.assertEqual(j['images']['marketing'], {'white_1x1': 'images/marketing/white_1x1.jpg', 'scene_3x4': 'images/marketing/scene_3x4.jpg'})
        self.assertEqual(j['images']['main_white_1x1'], 'images/main/01_x.jpg'); self.assertEqual(len(j['images']['gallery_1x1']), 5)
        self.assertEqual(len(j['images']['detail']), 9); self.assertEqual(len(j['images']['extra']), 2)
        self.assertEqual(j['attributes']['marketplace_attributes'], [{'name': 'Materiale', 'value': 'Acrilico'}, {'name': 'Tipo di animale', 'value': 'Cane'}])

    def test_sizes_and_colour_variants(self):
        self.assertEqual(engine.with_cm('S: 12" M: 14 inch'), 'S: 12" (30 cm) M: 14" (36 cm)')
        p = self.add(sizeChart='S: schiena 25 cm')
        self.assertEqual(engine.size_facts(server.get_product(p['id'])), '45 × 35 × 15 cm' + chr(10) + 'S: schiena 25 cm')
        png = io.BytesIO()
        from PIL import Image
        Image.new('RGB', (4, 4)).save(png, 'PNG')
        p = server.mutate('/api/reference', {'id': p['id'], 'data': base64.b64encode(png.getvalue()).decode()})
        ref = p['references'][0]
        p = server.mutate('/api/products', {'id': p['id'], 'variantsEnabled': True, 'colors': [{'name': 'Rosso', 'ref': ref}, {'name': 'Blu', 'ref': '../../x.png'}, {'name': ' '}]})
        self.assertEqual(p['colors'], [{'name': 'Rosso', 'ref': ref}, {'name': 'Blu', 'ref': ''}])
        with self.assertRaises(ValueError): server.mutate('/api/products', {'id': p['id'], 'colors': [{'name': str(i)} for i in range(10)]})
        # colours detected by the image job (colors.json) - strings or {it, zh}
        run = server.DATA / 'runs' / 'c1'; run.mkdir(parents=True)
        (run / 'colors.json').write_text(json.dumps([{'it': 'Azzurro', 'zh': '浅蓝'}, 'Rosa', {'zh': '紫色'}, 5, {}]), encoding='utf-8')
        self.assertEqual(engine.read_colors(run), ['Azzurro / 浅蓝', 'Rosa', '紫色'])
        self.assertEqual(engine.read_colors(server.DATA / 'missing'), [])
        # variants folder -> SKU images per colour in listing.json
        server.mutate('/api/products', {'id': p['id'], 'colors': [{'name': 'Rosso'}, {'name': 'Blu navy'}]})
        self.fake_v2_assets(server.get_product(p['id']))
        root = server.DATA / 'runs' / 'v2' / 'variants'; root.mkdir()
        for n in ['V01_rosso.jpg', 'V02_blu-navy.jpg']: Image.new('RGB', (1000, 1000)).save(root / n)
        read = [a for a in server.state()['products'][0]['assets'] if a['group'] == 'variants']
        self.assertEqual([a['use'] for a in read], ['颜色 SKU 图 · Rosso', '颜色 SKU 图 · Blu navy'])
        j = json.loads(zipfile.ZipFile(io.BytesIO(server.bundle(server.get_product(p['id'])))).read('listing.json'))
        self.assertEqual([(v['variant_sku'], v['color'], v['image']) for v in j['variants']],
                         [('PET-001-C01', 'Rosso', 'images/variants/V01_rosso.jpg'), ('PET-001-C02', 'Blu navy', 'images/variants/V02_blu-navy.jpg')])
        self.assertEqual(len(server.state()['products'][0]['boards']), 3)

    def test_size_variants_and_sku_matrix(self):
        run = server.DATA / 'runs' / 's1'; run.mkdir(parents=True)
        (run / 'sizes.json').write_text(json.dumps([{'label': 'L', 'zh': '大号', 'size': '110 × 80 cm'}, 'M 90 × 70 cm', {'size': '80 × 60 cm'}, 3]), encoding='utf-8')
        self.assertEqual(engine.read_sizes(run), ['L · 110 × 80 cm', 'M 90 × 70 cm', '80 × 60 cm'])
        self.assertEqual(engine.sku_plan(['a', 'b'], ['L', 'M']), (['a', 'b'], ['L', 'M'], []))
        colors, sizes, skipped = engine.sku_plan([str(i) for i in range(12)], ['L', 'M', 'S'])
        self.assertEqual((len(colors), sizes, skipped), (12, ['L', 'M'], ['S']))
        p = self.add()
        p = server.mutate('/api/products', {'id': p['id'], 'variantsEnabled': True, 'sizesEnabled': 'true'})
        self.assertTrue(p['sizesEnabled'])
        p = self.fake_v2_assets(server.get_product(p['id']))
        p['colors'] = [{'name': 'Grigio', 'ref': ''}, {'name': 'Marrone', 'ref': ''}]
        p['sizes'] = [{'name': 'L · 110 × 80 cm'}, {'name': 'M · 90 × 70 cm'}, {'name': 'S · 80 × 60 cm'}]
        server.save('products', p)
        from PIL import Image
        root = server.DATA / 'runs' / 'v2'
        for sub, names in [('variants', ['V01_grigio.jpg', 'V02_marrone.jpg']), ('sizes', ['S01_l.jpg', 'S02_m.jpg', 'S03_s.jpg'])]:
            (root / sub).mkdir(exist_ok=True)
            for n in names: Image.new('RGB', (1000, 1000)).save(root / sub / n)
        Image.new('RGB', (30, 30)).save(root / 'masters' / 'M4_SKU_BOARD.png')
        read = server.state()['products'][0]
        self.assertEqual([a['use'] for a in read['assets'] if a['group'] == 'sizes'], ['尺寸 SKU 图 · L · 110 × 80 cm', '尺寸 SKU 图 · M · 90 × 70 cm', '尺寸 SKU 图 · S · 80 × 60 cm'])
        self.assertEqual(len(read['boards']), 4)
        j = json.loads(zipfile.ZipFile(io.BytesIO(server.bundle(server.get_product(p['id'])))).read('listing.json'))
        rows = [(v['variant_sku'], v['color'], v['size'], v['image']) for v in j['variants']]
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[0], ('PET-001-C01-S01', 'Grigio', 'L · 110 × 80 cm', 'images/variants/V01_grigio.jpg'))
        self.assertEqual(rows[-1], ('PET-001-C02-S03', 'Marrone', 'S · 80 × 60 cm', 'images/variants/V02_marrone.jpg'))
        self.assertEqual([v['stock'] for v in j['variants']], [50, 0, 0, 0, 0, 0])
        self.assertEqual(len(j['images']['sizes']), 3)
        # sizes only: each row uses its size image
        p = server.get_product(p['id']); p['variantsEnabled'] = False; server.save('products', p)
        j = json.loads(zipfile.ZipFile(io.BytesIO(server.bundle(server.get_product(p['id'])))).read('listing.json'))
        self.assertEqual([(v['variant_sku'], v['image']) for v in j['variants']], [('PET-001-S01', 'images/sizes/S01_l.jpg'), ('PET-001-S02', 'images/sizes/S02_m.jpg'), ('PET-001-S03', 'images/sizes/S03_s.jpg')])

    def test_service_points_setting(self):
        s = engine.settings({'servicePoints': 'Spedizione dal magazzino in Italia'})
        self.assertEqual(s['servicePoints'], 'Spedizione dal magazzino in Italia')

    def test_edit_adopt_and_revert(self):
        p = self.fake_assets(self.add())
        from PIL import Image
        (server.DATA / 'runs' / 'e1').mkdir(parents=True); Image.new('RGB', (1000, 1000), 'red').save(server.DATA / 'runs' / 'e1' / 'edited.png')
        asset = server.state()['products'][0]['assets'][2]
        server.save('jobs', {'id': 'e1', 'productId': p['id'], 'sku': p['sku'], 'kind': 'edit', 'status': 'completed', 'asset': asset['path'], 'edited': 'runs/e1/edited.png', 'createdAt': engine.now()})
        server.mutate('/api/review', {'id': p['id'], 'approved': True})
        adopted = server.mutate('/api/adopt-edit', {'id': p['id'], 'jobId': 'e1'})
        self.assertFalse(adopted['assetReview'])
        self.assertEqual(server.state()['products'][0]['assets'][2]['path'], 'runs/e1/edited.png')
        server.mutate('/api/revert-asset', {'id': p['id'], 'originalPath': asset['originalPath']})
        self.assertEqual(server.state()['products'][0]['assets'][2]['path'], asset['originalPath'])

    def test_reference_upload_order_and_limits(self):
        p = self.add()
        png = io.BytesIO()
        from PIL import Image
        Image.new('RGB', (4, 4)).save(png, 'PNG')
        data = base64.b64encode(png.getvalue()).decode()
        for _ in range(2): p = server.mutate('/api/reference', {'id': p['id'], 'data': data})
        self.assertEqual(len(p['references']), 2)
        swapped = server.mutate('/api/reference-order', {'id': p['id'], 'references': p['references'][::-1]})
        self.assertEqual(swapped['references'][0], p['references'][1])
        with self.assertRaises(ValueError): server.mutate('/api/reference', {'id': p['id'], 'data': base64.b64encode(b'GIF89a....').decode()})
        with self.assertRaises(ValueError): server.mutate('/api/reference-order', {'id': p['id'], 'references': ['../../secret.jpg']})

    def test_import_workbook_from_generated_template(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
        import build_workbooks
        wb = build_workbooks.build_ops()   # no source files: one example row
        ws = wb['上新排期']
        for col, v in {'C': 4006592012345, 'D': '1005001', 'E': 'Cuccia', 'F': '猫窝', 'G': 6.2, 'I': 29.99, 'J': 24.99, 'L': 10, 'N': '完成', 'O': '进行中', 'P': '未开始'}.items():
            ws[f'{col}4'] = v
        ws['C5'] = 4006592000000  # no name -> skipped
        buf = io.BytesIO(); wb.save(buf)
        result = server.import_workbook(buf.getvalue())
        self.assertEqual(result['created'], 1)
        self.assertTrue(any('示例' in s for s in result['skipped'])); self.assertTrue(any('缺少商品名称' in s for s in result['skipped']))
        p = [x for x in server.state()['products'] if x['sku'] == '4006592012345'][0]
        self.assertEqual((p['nameZh'], p['nameIt'], p['cost'], p['stock']), ('猫窝', 'Cuccia', 6.2, 10))
        ae = p['listing']['AliExpress']
        self.assertEqual((ae['status'], ae['productId'], ae['price'], ae['promoPrice']), ('已上架', '1005001', 29.99, 24.99))
        self.assertEqual(p['listing']['Amazon']['status'], '草稿'); self.assertEqual(p['listing']['TikTok Shop']['status'], '待上架')
        # Re-import updates in place and does not wipe web-only fields
        server.mutate('/api/products', {'id': p['id'], 'sellingPoints': '可机洗'})
        self.assertEqual(server.import_workbook(buf.getvalue())['created'], 0)
        self.assertEqual(server.get_product(p['id'])['sellingPoints'], '可机洗')

    def test_research_workbook_builds(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
        import build_workbooks
        ws = build_workbooks.build_research().active
        self.assertEqual(ws['T2'].value, '单件利润')
        self.assertEqual(ws['T3'].value, '=IF(O3="","",O3+P3-F3-Q3-R3-S3)')

    def test_job_submission_guards(self):
        p = self.add()
        jobs = engine.Jobs(server.DATA, server.records, server.save, server.config)
        which = engine.codex_bin
        engine.codex_bin = lambda: 'codex'
        try:
            with self.assertRaisesRegex(ValueError, '实拍'): jobs.submit(server.get_product(p['id']), 'images')
            with self.assertRaisesRegex(ValueError, 'API'): jobs.submit(server.get_product(p['id']), 'publish', platform='Amazon')
            with self.assertRaises(ValueError): jobs.submit(server.get_product(p['id']), 'research')
        finally: engine.codex_bin = which

    def test_delete_product(self):
        p = self.add()
        server.mutate('/api/delete-product', {'id': p['id']})
        self.assertEqual(server.state()['products'], [])


if __name__ == '__main__': unittest.main()
