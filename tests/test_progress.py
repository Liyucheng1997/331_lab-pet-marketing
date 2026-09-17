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
        self.touch('masters/M2_DETAIL_PREVIEW_BOARD.png');self.assertEqual(progress.describe(self.job,self.data)['percent'],55)
        for i in range(9):self.touch(f'listing/{i}.png')
        self.assertEqual(progress.describe(self.job,self.data)['outputs'],9)
        for i in range(9):self.touch(f'detail/{i}.jpg')
        self.assertEqual(progress.describe(self.job,self.data)['percent'],95)
        self.job.update(status='completed',finishedAt='2026-01-01T00:02:30+00:00')
        result=progress.describe(self.job,self.data)
        self.assertEqual(result['percent'],100);self.assertEqual(result['elapsedSeconds'],150)
    def test_failure_does_not_show_100_and_unknown_duration(self):
        self.touch('facts.json');self.job['status']='failed';self.job.pop('startedAt')
        result=progress.describe(self.job,self.data)
        self.assertLess(result['percent'],100);self.assertIsNone(result['elapsedSeconds'])
    def test_research_indeterminate_and_queued(self):
        self.job['kind']='research';self.assertTrue(progress.describe(self.job,self.data)['indeterminate'])
        self.job['status']='queued';self.assertEqual(progress.describe(self.job,self.data)['percent'],0)
    def test_unsafe_folder_not_read(self):
        self.job['folder']='../../';self.assertEqual(progress.describe(self.job,self.data)['boards'],0)

if __name__=='__main__':unittest.main()
