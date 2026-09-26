"""Read observable job milestones, never simulate completion from elapsed time."""
from pathlib import Path
import json
from datetime import datetime, timezone

TOTAL=19  # 九宫格电商法 V2.0: main 6 + marketing 2 + extra 2 + detail 9 (+1 per colour variant)
TERMINAL={'completed','failed','interrupted','cancelled','needs_info','no_results'}

def listed(root,name):
    try:
        data=json.loads((root/name).read_text(encoding='utf-8'))
        return len(data) if isinstance(data,list) else 0
    except (OSError,ValueError,TypeError):return 0

def sku_count(job,root):
    # colors.json / sizes.json are written by the image job before generation; at most 14 SKU images (5 on M3 + 9 on M4)
    if not root:return 0
    return min((listed(root,'colors.json') if job.get('variants') else 0)+(listed(root,'sizes.json') if job.get('sizeVariants') else 0),14)

def describe(job,data):
    status=job.get('status','queued');kind=job.get('kind','research')
    folder=job.get('folder');root=(data/folder).resolve() if folder else None
    if root and not root.is_relative_to(data.resolve()):root=None
    def exists(name):
        try:return bool(root and (root/name).is_file() and (root/name).stat().st_size)
        except OSError:return False
    boards=sum(exists('masters/'+name) for name in ['M1_LISTING_PREVIEW_BOARD.png','M2_DETAIL_PREVIEW_BOARD.png','M3_MARKETING_SCENE_3x4.png','M4_SKU_BOARD.png'])
    skus=sku_count(job,root);total=TOTAL+skus;masters=4 if skus>5 else 3
    outputs=0
    if root:
        for sub in ['main','marketing','variants','sizes','extra','detail']:
            for f in (root/sub).glob('*'):
                try:outputs+=int(f.suffix.lower() in ['.png','.jpg','.jpeg'] and f.stat().st_size>0)
                except OSError:pass
    outputs=min(outputs,total)
    percent,phase,label=0,0,'等待执行'
    indeterminate=False
    if status!='queued':
        percent,label=5,'检查登录与准备任务'
        if kind=='images':
            if exists('facts.json'):percent,label=10,'整理商品与参考图'
            if exists('prompt_plan.md'):percent,phase,label=20,1,'生成主图九宫格 M1'
            names=['M1 主图九宫格','M2 详情九宫格','M3 场景 + SKU 图' if job.get('variants') or job.get('sizeVariants') else 'M3 3:4 营销图','M4 SKU 九宫格']
            if 0<boards<masters:percent,phase,label=20+int(boards/masters*35),1,f'已生成 {boards}/{masters} 张原图，下一张：{names[boards]}'
            if boards>=masters:percent,phase,label=55,2,f'{masters} 张原图就绪，裁剪与高清化'
            if outputs:percent,phase,label=55+int(outputs/total*35),3,f'已输出 {outputs} / {total} 张'
            if outputs==total:percent,phase,label=95,4,f'{total} 张图片已输出，正在验收'
        elif kind=='edit':
            percent,phase,label=15,1,'正在进行局部修改'
            indeterminate=True
            if exists('edited.png'):percent,phase,label,indeterminate=95,4,'修改图已输出，正在验收',False
        elif kind=='copy':
            percent,phase,label=15,1,'撰写三平台意大利语文案'
            indeterminate=True
            if exists('result.json'):percent,phase,label,indeterminate=95,4,'整理并检查文案长度',False
        elif kind=='publish':
            percent,phase,label=15,1,'在浏览器中填写 AliExpress 表单'
            indeterminate=True
            if exists('result.json'):percent,phase,label,indeterminate=95,4,'保存草稿并记录结果',False
        else:
            percent,phase,label=10,1,'处理中'
            indeterminate=True
    if status in {'completed','needs_info','no_results'}:
        percent,phase,indeterminate=100,5,False
        label={'completed':'处理完成','needs_info':'检索结束，需要补充资料','no_results':'检索结束，暂无可核实报价'}[status]
    elif status in {'failed','interrupted','cancelled'}:
        label={'failed':'任务失败，可查看日志重试','interrupted':'任务已中断，可重新提交','cancelled':'任务已取消'}[status]
        indeterminate=False
    elapsed=None
    start=job.get('startedAt')
    if start:
        try:
            end=datetime.fromisoformat(job['finishedAt']) if job.get('finishedAt') else datetime.now(timezone.utc) if status not in TERMINAL else None
            if end:elapsed=max(0,int((end-datetime.fromisoformat(start)).total_seconds()))
        except (ValueError,TypeError):pass
    updated=job.get('updatedAt') or start or job.get('createdAt')
    if root and (root/'events.jsonl').is_file():
        try:updated=datetime.fromtimestamp((root/'events.jsonl').stat().st_mtime,timezone.utc).isoformat()
        except OSError:pass
    return {'percent':percent,'phase':phase,'label':label,'boards':boards,'outputs':outputs,'indeterminate':indeterminate,'elapsedSeconds':elapsed,'lastActivityAt':updated,'basis':'按文件里程碑计算的阶段进度，不是模型生成百分比'}
