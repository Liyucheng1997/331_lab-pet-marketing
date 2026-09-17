import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine

class ResearchRegression(unittest.TestCase):
    def test_reported_barcode_is_structurally_valid_not_identified(self):
        check=engine.barcode_status('8388776542996')
        self.assertEqual(check['status'],'valid')
        self.assertIn('不代表',check['message'])

    def test_bad_checksum_and_zero_preservation(self):
        self.assertEqual(engine.barcode_status('8388776542995')['status'],'invalid')
        self.assertEqual(engine.normalize_barcode(' ０３６０００ ２９１４５２ '),'036000291452')
        self.assertEqual(engine.barcode_status('036000291452')['status'],'valid')

    def test_empty_results_do_not_write_fake_identity(self):
        p={'nameZh':'','nameIt':'','descriptionZh':'','descriptionIt':'','offers':[]}
        result={'nameZh':'未识别商品（EAN：8388776542996）','nameIt':'Prodotto non identificato','descriptionZh':'未找到商品','descriptionIt':'Non trovato','offers':[], 'advice':'补充资料','warnings':[], 'identity':{'status':'unresolved','brand':'','model':'','sources':[],'reason':'没有公开记录'},'platformResults':[]}
        out=engine.merge_research(p,result)
        self.assertEqual(out['nameZh'],'')
        self.assertEqual(out['researchStatus'],'needs_info')

    def test_prompt_has_identity_first_and_fallbacks(self):
        prompt=engine.research_prompt({'ean':'8388776542996','brand':'','model':'','searchTerms':'','supplierUrl':''},True)
        for term in ['PHASE 1','PHASE 2','manufacturer','supplierUrl','reference image','robots','similar']:
            self.assertIn(term,prompt)

if __name__=='__main__':unittest.main()
