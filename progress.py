"""Read observable job milestones, never simulate completion from elapsed time."""
from pathlib import Path
from datetime import datetime, timezone

TERMINAL={'completed','failed','interrupted','needs_info','no_results'}

def describe(job,data):
    status=job.get('status','queued');kind=job.get('kind','research')
    folder=job.get('folder');root=(data/folder).resolve() if folder else None
    if root and not root.is_relative_to(data.resolve()):root=None
    def exists(name):
        try:return bool(root and (root/name).is_file() and (root/name).stat().st_size)
        except OSError:return False
    boards=sum(exists('masters/'+name) for name in ['M1_LISTING_PREVIEW_BOARD.png','M2_DETAIL_PREVIEW_BOARD.png'])
    outputs=0
    if root:
        for sub in ['listing','detail']:
            for f in (root/sub).glob('*'):
                try:outputs+=int(f.suffix.lower() in ['.png','.jpg','.jpeg'] and f.stat().st_size>0)
                except OSError:pass
    outputs=min(outputs,18)
    percent,phase,label=0,0,'等待执行'
    indeterminate=False
    if status!='queued':
        percent,label=5,'检查登录与准备任务'
        if kind=='images':
            if exists('facts.json'):percent,label=10,'整理商品与参考图'
            if exists('prompt_plan.md'):percent,phase,label=20,1,'生成第一张九宫格'
            if boards==1:percent,phase,label=38,1,'已生成 1 / 2 张九宫格'
            if boards==2:percent,phase,label=55,2,'两张九宫格就绪，裁剪与高清化'
            if outputs:percent,phase,label=55+int(outputs/18*35),3,f'已输出 {outputs} / 18 张高清图'
            if outputs==18:percent,phase,label=95,4,'18 张图片已输出，正在验收'
        elif kind=='edit':
            percent,phase,label=15,1,'正在进行局部修改'
            indeterminate=True
            if exists('edited.png'):percent,phase,label,indeterminate=95,4,'修改图已输出，正在验收',False
        else:
            percent,phase,label=10,1,'识别商品与检索五个平台'
            indeterminate=True
            if exists('result.json'):percent,phase,label,indeterminate=95,4,'整理来源与验证调研结果',False
    if status in {'completed','needs_info','no_results'}:
        percent,phase,indeterminate=100,5,False
        label={'completed':'处理完成','needs_info':'检索结束，需要补充资料','no_results':'检索结束，暂无可核实报价'}[status]
    elif status in {'failed','interrupted'}:
        label='任务失败，可查看日志重试' if status=='failed' else '任务已中断，可重新提交'
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
