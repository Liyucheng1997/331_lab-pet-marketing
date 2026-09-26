import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import progress

class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.data=Path(self.tmp.name);self.root=self.data/'runs'/'test';self.root.mkdir(parents=True)
        self.job={'kind':'images','status':'running','folder':'runs/test','startedAt':'2026-01-01T00:00:00+00:00'}
    def tearDown(self):self.tmp.cleanup()
    def touch(self,path):
        p=self.root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'file-output')
    def test_no_fake_time_based_progress(self):
        self.touch('facts.json')
        a=progress.describe(self.job,self.data)
        self.job['startedAt']='2025-01-01T00:00:00+00:00'
        b=progress.describe(self.job,self.data)
        self.assertEqual(a['percent'],10);self.assertEqual(a['percent'],b['percent'])
    def test_actual_boards_and_images_then_validation(self):
        self.touch('prompt_plan.md');self.assertEqual(progress.describe(self.job,self.data)['percent'],20)
        self.touch('masters/M1_LISTING_PREVIEW_BOARD.png');self.assertEqual(progress.describe(self.job,self.data)['boards'],1)
        self.touch('masters/M2_DETAIL_PREVIEW_BOARD.png');self.assertEqual(progress.describe(self.job,self.data)['percent'],43)
        self.touch('masters/M3_MARKETING_SCENE_3x4.png');self.assertEqual(progress.describe(self.job,self.data)['percent'],55)
        for i in range(6):self.touch(f'main/{i}.jpg')
        self.assertEqual(progress.describe(self.job,self.data)['outputs'],6)
        for name in ['marketing/white_1x1.jpg','marketing/scene_3x4.jpg','extra/07.png','extra/08.jpg']+[f'detail/D{i}.png' for i in range(9)]:self.touch(name)
        self.assertEqual(progress.describe(self.job,self.data)['percent'],95)
        self.job.update(status='completed',finishedAt='2026-01-01T00:02:30+00:00')
        result=progress.describe(self.job,self.data)
        self.assertEqual(result['percent'],100);self.assertEqual(result['elapsedSeconds'],150)
    def test_variants_total_follows_detected_colours(self):
        self.job['variants']=True
        for n in ['M1_LISTING_PREVIEW_BOARD.png','M2_DETAIL_PREVIEW_BOARD.png']:self.touch('masters/'+n)
        self.assertIn('M3 场景 + SKU 图',progress.describe(self.job,self.data)['label'])
        (self.root/'colors.json').write_text('["Azzurro","Rosa","Viola","Blu","Verde","Nero"]',encoding='utf-8')
        self.touch('masters/M3_MARKETING_SCENE_3x4.png');self.touch('masters/M4_SKU_BOARD.png')
        for i in range(19):self.touch(f'main/{i}.jpg')
        self.assertEqual(progress.describe(self.job,self.data)['label'],'已输出 19 / 25 张')
        for i in range(6):self.touch(f'variants/V{i}.jpg')
        self.assertEqual(progress.describe(self.job,self.data)['percent'],95)
    def test_colours_and_sizes_need_fourth_board(self):
        self.job.update(variants=True,sizeVariants=True)
        (self.root/'colors.json').write_text('["Grigio","Marrone","Blu"]',encoding='utf-8')
        (self.root/'sizes.json').write_text('[{"label":"L","size":"110 x 80 cm"},{"label":"M"},{"label":"S"}]',encoding='utf-8')
        for n in ['M1_LISTING_PREVIEW_BOARD.png','M2_DETAIL_PREVIEW_BOARD.png','M3_MARKETING_SCENE_3x4.png']:self.touch('masters/'+n)
        self.assertIn('3/4',progress.describe(self.job,self.data)['label'])
        self.touch('masters/M4_SKU_BOARD.png')
        for i in range(19):self.touch(f'main/{i}.jpg')
        for i in range(3):self.touch(f'sizes/S{i}.jpg')
        self.assertEqual(progress.describe(self.job,self.data)['label'],'已输出 22 / 25 张')
    def test_failure_does_not_show_100_and_unknown_duration(self):
        self.touch('facts.json');self.job['status']='failed';self.job.pop('startedAt')
        result=progress.describe(self.job,self.data)
        self.assertLess(result['percent'],100);self.assertIsNone(result['elapsedSeconds'])
    def test_copy_indeterminate_and_queued(self):
        self.job['kind']='copy';self.assertTrue(progress.describe(self.job,self.data)['indeterminate'])
        self.touch('result.json');self.assertEqual(progress.describe(self.job,self.data)['percent'],95)
        self.job['status']='queued';self.assertEqual(progress.describe(self.job,self.data)['percent'],0)
    def test_cancelled_is_terminal(self):
        self.job.update(status='cancelled',finishedAt='2026-01-01T00:00:10+00:00')
        result=progress.describe(self.job,self.data)
        self.assertEqual(result['label'],'任务已取消');self.assertEqual(result['elapsedSeconds'],10)
    def test_unsafe_folder_not_read(self):
        self.job['folder']='../../';self.assertEqual(progress.describe(self.job,self.data)['boards'],0)

if __name__=='__main__':unittest.main()
