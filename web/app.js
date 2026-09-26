'use strict';
/* PetOps Studio — 作图 · 画廊 · 上架. Vanilla JS, talks to the local server only. */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => v == null || v === '' ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v);
const file = p => '/files/' + String(p || '').split('/').map(encodeURIComponent).join('/');
const bytes = s => new TextEncoder().encode(s || '').length;

let S = { products: [], jobs: [], settings: {}, capabilities: {}, platforms: ['AliExpress', 'Amazon', 'TikTok Shop'], statuses: [], limits: {} };
let route = { view: 'gallery', id: '', sub: '' };
let ui = { search: '', galleryFilter: 'all', studioFilter: 'all', listingFilter: 'all', picked: new Set(), tasksOpen: false, box: null, saving: {}, pollBusy: false };

const VIEWS = [['studio', '作图'], ['gallery', '画廊'], ['listing', '上架']];
const SHORT = { AliExpress: 'AE', Amazon: 'AMZ', 'TikTok Shop': 'TT' };
const KIND = { images: '九宫格作图', edit: '局部修改', copy: 'AI 文案', publish: '自动存草稿' };
const JOB_STATUS = { queued: '排队中', running: '进行中', completed: '完成', failed: '失败', interrupted: '已中断', cancelled: '已取消' };
const STATUS_TONE = { 待上架: '', 草稿: 'warn', 审核中: 'info', 已上架: 'ok', 被拒: 'bad', 已下架: 'mute' };
const ACTIVE = j => ['queued', 'running'].includes(j.status);
const PROMPT_CHIPS = ['意大利现代公寓场景', '猫咪互动', '狗狗户外', '温暖自然光', '极简白底', '突出材质细节'];

const product = id => S.products.find(p => p.id === id);
const jobsOf = (id, kind) => S.jobs.filter(j => j.productId === id && (!kind || j.kind === kind));
const activeJob = (id, kinds = ['images', 'edit', 'copy', 'publish']) => S.jobs.find(j => j.productId === id && kinds.includes(j.kind) && ACTIVE(j));
const displayName = p => p.nameZh || p.nameIt || p.sku;
const cover = p => { const main = (p.assets || []).find(a => a.group === 'listing'); return main ? file(main.path) : p.references?.[0] ? file(p.references[0]) : '' };
const listedCount = p => S.platforms.filter(s => p.listing?.[s]?.status === '已上架').length;
const hasCopy = p => S.platforms.some(s => p.listing?.[s]?.title);

/* ---------------------------------------------------------------- infrastructure */
function toast(text, tone = '') { const t = $('#toast'); t.textContent = text; t.className = 'show ' + tone; clearTimeout(toast.timer); toast.timer = setTimeout(() => t.className = '', 4200) }
async function api(path, data) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => ({ error: '服务无响应' }));
  if (!r.ok) throw Error(j.error || '操作失败');
  return j;
}
async function act(path, data, msg) { try { const r = await api(path, data); await refresh(); if (msg) toast(msg, 'ok'); return r } catch (e) { toast(e.message, 'bad'); return null } }
async function refresh(redraw = true) {
  try { const r = await fetch('/api/state'); if (!r.ok) throw Error('无法连接本地服务'); S = await r.json(); if (redraw) render() }
  catch (e) { toast(e.message + '。请确认 PetOps 服务正在运行。', 'bad') }
}
function go(view, id = '', sub = '') { location.hash = [view, id, sub].filter(Boolean).join('/') }
function readHash() {
  const [view, id = '', sub = ''] = decodeURIComponent(location.hash.slice(1)).split('/');
  route = { view: ['studio', 'gallery', 'product', 'listing', 'settings'].includes(view) ? view : 'gallery', id, sub };
}
function editing() { return document.activeElement?.matches('input,textarea,select') || $('#dialog').open }
function download(url) { const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove() }
async function copyText(text, label = '内容') {
  if (!text) return toast('没有可复制的' + label);
  try { await navigator.clipboard.writeText(text); toast('已复制' + label, 'ok') }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('已复制' + label, 'ok') }
}
function readFile(f) { return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f) }) }
function icon(name) {
  const d = {
    plus: 'M12 5v14M5 12h14', down: 'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14', copy: 'M9 9h10v10H9zM5 15V5h10', edit: 'm4 20 4-1 11-11-3-3L5 16l-1 4z',
    back: 'M15 18l-6-6 6-6', close: 'M6 6l12 12M18 6 6 18', left: 'M15 18l-6-6 6-6', right: 'm9 18 6-6-6-6', spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
    upload: 'M12 16V4m0 0-4 4m4-4 4 4M5 20h14', image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5', check: 'm5 12 4 4 10-10', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', table: 'M4 5h16v14H4zM4 10h16M10 5v14', robot: 'M7 9h10v9H7zM12 5v4M9 13h.01M15 13h.01'
  }[name];
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}
function pill(text, tone = '') { return `<span class="pill ${tone}">${esc(text)}</span>` }
function empty(title, text, action = '') { return `<div class="empty"><div class="empty-art">${icon('image')}</div><h3>${title}</h3><p>${text}</p>${action}</div>` }
function thumb(p, cls = '') { const src = cover(p); return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<div class="${cls} noimg">${icon('image')}</div>` }

/* ---------------------------------------------------------------- chrome */
function renderNav() {
  const current = route.view === 'product' ? 'gallery' : route.view;
  $('#nav').innerHTML = VIEWS.map(([v, t], i) => `<a href="#${v}" class="${current === v ? 'active' : ''}" ${current === v ? 'aria-current="page"' : ''}><small>${i + 1}</small>${t}</a>`).join('');
  const active = S.jobs.filter(ACTIVE).length;
  $('#task-count').textContent = active; $('#task-count').classList.toggle('live', active > 0);
}
function render() {
  renderNav();
  const views = { studio, gallery, product: productPage, listing: listingView, settings: settingsView };
  $('#app').innerHTML = views[route.view]();
  renderTasks(); renderLive();
  if (ui.box) renderLightbox();
  document.title = 'PetOps Studio · ' + ({ studio: '作图', gallery: '画廊', product: '画廊', listing: '上架', settings: '设置' }[route.view]);
}
function toggleTasks(force) { ui.tasksOpen = force ?? !ui.tasksOpen; $('#tasks').hidden = !ui.tasksOpen; $('#tasks-button').setAttribute('aria-expanded', ui.tasksOpen); renderTasks() }
function renderTasks() {
  if (!ui.tasksOpen) return;
  const jobs = [...S.jobs.filter(ACTIVE), ...S.jobs.filter(j => !ACTIVE(j))].slice(0, 40);
  $('#tasks').innerHTML = `<div class="drawer-head"><h2>任务</h2><button class="icon" aria-label="关闭" onclick="toggleTasks(false)">${icon('close')}</button></div>` +
    (jobs.length ? jobs.map(j => jobCard(j, true)).join('') : `<p class="muted pad">还没有任务。作图、生成文案和自动存草稿都会出现在这里。</p>`);
}
function progressBar(j) {
  const pg = j.progress || { percent: 0, label: j.message };
  const bad = ['failed', 'interrupted', 'cancelled'].includes(j.status);
  const time = pg.elapsedSeconds == null ? '' : pg.elapsedSeconds < 60 ? pg.elapsedSeconds + ' 秒' : Math.floor(pg.elapsedSeconds / 60) + ' 分 ' + pg.elapsedSeconds % 60 + ' 秒';
  return `<div class="progress ${pg.indeterminate ? 'indeterminate' : ''} ${bad ? 'bad' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" ${pg.indeterminate ? '' : `aria-valuenow="${pg.percent}"`}><i style="width:${pg.indeterminate ? 35 : pg.percent}%"></i></div>
  <div class="progress-meta"><span>${esc(pg.label || '')}</span><span>${ACTIVE(j) && time ? '已运行 ' + time : time ? '用时 ' + time : ''}${pg.indeterminate || !ACTIVE(j) ? '' : ' · ' + pg.percent + '%'}</span></div>`;
}
function jobCard(j, compact = false) {
  const p = product(j.productId), tone = j.status === 'completed' ? 'ok' : ACTIVE(j) ? 'info' : 'bad';
  return `<div class="job ${compact ? 'compact' : ''}" data-job="${j.id}">
    <div class="job-top"><b>${esc(KIND[j.kind] || j.kind)}${j.platform ? ' · ' + esc(j.platform) : ''}</b>${pill(JOB_STATUS[j.status] || j.status, tone)}</div>
    <p class="job-name">${p ? `<a href="#product/${p.id}">${esc(displayName(p))}</a>` : esc(j.sku)} <span class="muted">${esc(new Date(j.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></p>
    <div data-live-job="${j.id}">${progressBar(j)}</div>
    ${!ACTIVE(j) && j.status !== 'completed' ? `<p class="job-msg">${esc(j.message)}</p>` : j.status === 'completed' && j.kind !== 'images' ? `<p class="job-msg">${esc(j.message)}</p>` : ''}
    <div class="job-actions">
      ${ACTIVE(j) ? `<button class="small" onclick="cancelJob('${j.id}')">取消</button>` : ''}
      ${['failed', 'interrupted', 'cancelled'].includes(j.status) ? `<button class="small" onclick="retryJob('${j.id}')">重试</button>` : ''}
      ${j.folder ? `<a class="small-link" target="_blank" href="${file(j.folder.replaceAll('\\', '/') + '/events.jsonl')}">日志</a>` : ''}
    </div></div>`;
}
function renderLive() {
  $$('[data-live-job]').forEach(el => { const j = S.jobs.find(x => x.id === el.dataset.liveJob); if (j) el.innerHTML = progressBar(j) });
  $$('[data-live-card]').forEach(el => { const j = activeJob(el.dataset.liveCard); el.innerHTML = j ? `<div class="card-progress">${progressBar(j)}</div>` : '' });
}
async function startJob(id, kind, extra = '', asset = '', platform = '') {
  const r = await act('jobs', { id, kind, extra, asset, platform }, { images: '已开始作图，约 15–40 分钟。进度见任务列表', copy: '正在生成三平台文案，通常 1–3 分钟', edit: '已提交局部修改', publish: '已开始自动填写 AliExpress，完成后保存为草稿' }[kind]);
  return r;
}
function cancelJob(id) { act('cancel-job', { id }, '已请求取消') }
function retryJob(id) { const j = S.jobs.find(x => x.id === id); if (j) startJob(j.productId, j.kind, j.extra, j.asset, j.platform) }

/* ---------------------------------------------------------------- product form & import */
function field(name, label, value = '', attrs = '', hint = '') { return `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value ?? '')}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>` }
function area(name, label, value = '', attrs = '', hint = '') { return `<label class="field wide"><span>${label}</span><textarea name="${name}" ${attrs}>${esc(value ?? '')}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>` }
function modal(title, body, wide = false) {
  const d = $('#dialog'); d.className = wide ? 'wide' : '';
  d.innerHTML = `<div class="dialog-head"><h2>${title}</h2><button class="icon" aria-label="关闭" onclick="$('#dialog').close()">${icon('close')}</button></div>${body}`;
  if (!d.open) d.showModal();
}
function editProduct(id) {
  const p = id ? product(id) : {};
  modal(id ? '编辑商品资料' : '新建商品', `<form id="product-form" class="form-grid">
    ${field('sku', 'SKU *', p.sku, 'required maxlength="80" autocomplete="off"')}
    ${field('ean', 'EAN 条码', p.ean, 'inputmode="numeric"', p.barcodeCheck?.status === 'invalid' ? '⚠ ' + esc(p.barcodeCheck.message) : '')}
    ${field('nameZh', '中文名称', p.nameZh)}${field('nameIt', '意大利语名称', p.nameIt, '', '可留空，AI 文案会生成')}
    ${field('brand', '品牌', p.brand, '', '无品牌留空')}${field('category', '品类', p.category, 'placeholder="例如：猫抓板、宠物窝"')}
    ${field('dimensions', '尺寸（单一尺寸商品）', p.dimensions, 'placeholder="45 × 55 × 40 cm"')}${field('weight', '重量', p.weight, 'placeholder="850 g"')}
    ${field('material', '材质', p.material)}${field('color', '颜色', p.color)}
    ${field('petModel', '宠物模特（同一商品所有图片用同一只动物）', p.petModel, 'placeholder="例如：奶油色泰迪，约 4 kg；留空由 AI 选定并记住"', '')}${field('stock', '库存', p.stock, 'type="number" min="0" step="1"')}${field('cost', '税前进货价 €', p.cost, 'type="number" min="0" step="0.01"')}
    ${area('sizeChart', '尺码表（多个尺码时每行一个，会原样标在尺寸图上）', p.sizeChart, 'rows="4" placeholder="S: 背长 25 cm, 胸围 36 cm&#10;M: 背长 30 cm, 胸围 42 cm&#10;也可以写英寸，例如 12&quot; — 系统会自动换算成厘米"', '填了尺寸或尺码表，尺寸图、参数图和尺码指南都会标出具体数字；不填只画测量示意。')}
    ${area('sellingPoints', '卖点 / 作图要点', p.sellingPoints, 'rows="3" placeholder="例如：可拆洗外套；防滑底；适合 5kg 以下猫咪"', '作图和文案都会用到。只写已确认的事实。')}
    ${area('packageContents', '包装内容', p.packageContents, 'rows="2" placeholder="例如：1 × 猫窝，1 × 靠垫"')}
    ${id ? '' : `<label class="field wide"><span>商品实拍图（可多选）</span><input type="file" name="files" accept="image/png,image/jpeg,image/webp" multiple></label>`}
    <div class="form-actions wide">${id ? `<button type="button" class="danger-link" onclick="deleteProduct('${id}')">删除商品</button>` : '<span></span>'}<div><button type="button" onclick="$('#dialog').close()">取消</button><button class="primary" type="submit">保存</button></div></div>
  </form>`, true);
  $('#product-form').onsubmit = async e => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true;
    try {
      const d = Object.fromEntries(new FormData(e.target)); delete d.files; if (id) d.id = id;
      const r = await api('products', d);
      const files = e.target.files?.files ? [...e.target.files.files] : [];
      for (const f of files) await api('reference', { id: r.id, data: await readFile(f) });
      $('#dialog').close(); await refresh(); toast('商品已保存', 'ok');
      if (!id && route.view === 'studio') go('studio', r.id);
    } catch (err) { toast(err.message, 'bad') } finally { btn.disabled = false }
  };
}
function deleteProduct(id) {
  const p = product(id);
  modal('删除商品', `<p>确定删除 <b>${esc(displayName(p))}</b>（${esc(p.sku)}）？商品记录和文案会从数据库移除；已生成的图片文件仍保留在 data/runs 目录中。</p>
    <div class="form-actions"><span></span><div><button onclick="$('#dialog').close()">取消</button><button class="danger" onclick="act('delete-product',{id:'${id}'},'商品已删除').then(r=>{if(r){$('#dialog').close();go('gallery')}})">删除</button></div></div>`);
}
function importDialog() {
  modal('从排期表导入商品', `<p>选择 <b>上新排期与销售统计表.xlsx</b>。系统读取“上新排期”工作表：EAN、商品简介、中文简介、进货价、库存，以及商品 ID、电商原价、日常促销价和三个平台的上架状态（完成 = 已上架）。</p>
    <ul class="tips"><li>按 EAN 匹配：已有商品只更新表格里有值的格子，不会清空网页中已填写的内容。</li><li>“备注”含“示例”的行会跳过。</li><li>也可以直接选你的 01_商品进价表。</li></ul>
    <form id="import-form"><label class="drop"><input type="file" name="xlsx" accept=".xlsx" required><span>${icon('table')} 选择 .xlsx 文件</span></label>
    <div class="form-actions"><span></span><div><button type="button" onclick="$('#dialog').close()">取消</button><button class="primary" type="submit">导入</button></div></div></form>`);
  $('#import-form').onsubmit = async e => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true;
    try {
      const f = e.target.xlsx.files[0]; if (!f) throw Error('请选择文件');
      const r = await api('import-xlsx', { data: await readFile(f) });
      await refresh();
      modal('导入完成', `<p>新建 <b>${r.created}</b> 个商品，更新 <b>${r.updated}</b> 个，写入平台上架信息 <b>${r.listingUpdates}</b> 条。</p>${r.skipped.length ? `<p class="muted">跳过 ${r.skipped.length} 行：</p><ul class="tips">${r.skipped.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}<div class="form-actions"><span></span><button class="primary" onclick="$('#dialog').close()">好的</button></div>`);
    } catch (err) { toast(err.message, 'bad') } finally { btn.disabled = false }
  };
}

/* ---------------------------------------------------------------- 1. studio */
function studioState(p) {
  if (activeJob(p.id, ['images'])) return 'running';
  return p.assetsReady ? 'done' : 'todo';
}
function studio() {
  const filters = [['all', '全部'], ['todo', '待作图'], ['running', '制作中'], ['done', '已完成']];
  const list = S.products.filter(p => (ui.studioFilter === 'all' || studioState(p) === ui.studioFilter) && matches(p));
  let p = product(route.id) || list[0] || S.products[0];
  if (p) route.id = p.id;
  return `<div class="page studio">
  <section class="queue">
    <div class="queue-head"><h2>作图队列</h2><button class="small primary" onclick="editProduct()">${icon('plus')}新建</button></div>
    <input class="search" placeholder="搜索 SKU / 名称 / EAN" value="${esc(ui.search)}" oninput="searchInput(this.value)">
    <div class="segmented">${filters.map(([v, t]) => `<button class="${ui.studioFilter === v ? 'on' : ''}" onclick="ui.studioFilter='${v}';render()">${t} <small>${S.products.filter(x => v === 'all' || studioState(x) === v).length}</small></button>`).join('')}</div>
    ${ui.picked.size ? `<div class="batchbar"><span>已选 ${ui.picked.size} 个</span><button class="small primary" onclick="batchImages()">批量作图</button><button class="small" onclick="ui.picked.clear();render()">清除</button></div>` : ''}
    <div class="queue-list">${list.length ? list.map(x => `<div class="queue-item ${p && x.id === p.id ? 'active' : ''}">
      <input type="checkbox" aria-label="选择 ${esc(x.sku)}" ${ui.picked.has(x.id) ? 'checked' : ''} onchange="this.checked?ui.picked.add('${x.id}'):ui.picked.delete('${x.id}');render()">
      <a href="#studio/${x.id}">${thumb(x, 'qthumb')}<span><b>${esc(displayName(x))}</b><small>${esc(x.sku)} · ${x.references.length} 张实拍</small></span>${{ running: pill('制作中', 'info'), done: pill(x.assets.length + ' 张', 'ok'), todo: x.references.length ? pill('可开始') : pill('缺实拍', 'warn') }[studioState(x)]}</a>
      <div class="queue-live" data-live-card="${x.id}"></div></div>`).join('') : `<p class="muted pad">${S.products.length ? '这个分类下没有商品。' : '还没有商品。新建一个，或在画廊从排期表导入。'}</p>`}</div>
  </section>
  <section class="workspace">${p ? studioProduct(p) : empty('从一个商品开始', '新建商品并上传 1–4 张实拍图（正面、侧面、细节、包装），就可以按 AliExpress 规范生成整套素材。', `<button class="primary" onclick="editProduct()">${icon('plus')}新建商品</button> <button onclick="importDialog()">${icon('table')}从排期表导入</button>`)}</section>
  </div>`;
}
function searchInput(v) { ui.search = v; render(); const el = $('.search'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length) } }
function matches(p) { const q = ui.search.trim().toLowerCase(); return !q || [p.sku, p.nameZh, p.nameIt, p.ean, p.category].join(' ').toLowerCase().includes(q) }
function engineProblems() {
  const c = S.capabilities, miss = [];
  if (!c.codex) miss.push('本机 Codex'); if (!c.skill) miss.push('九宫格技能'); if (!c.finalizer) miss.push('裁剪脚本'); if (!c.upscaler) miss.push('Real-ESRGAN');
  return miss;
}
function studioProduct(p) {
  const job = activeJob(p.id, ['images']), last = jobsOf(p.id, 'images')[0], miss = engineProblems();
  const facts = [['宠物模特', p.petModel], ['品牌', p.brand], ['尺寸', p.dimensions], ['材质', p.material], ['颜色', p.color], ['重量', p.weight]].filter(f => f[1]);
  return `<div class="ws-head"><div><p class="eyebrow">${esc(p.sku)}${p.category ? ' · ' + esc(p.category) : ''}</p><h1>${esc(displayName(p))}</h1><p class="muted">${esc(p.nameIt || '意大利语名称待生成')}</p></div>
    <div class="row-actions"><button onclick="editProduct('${p.id}')">${icon('edit')}编辑资料</button>${p.assetsReady ? `<button onclick="go('product','${p.id}')">${icon('image')}在画廊查看</button>` : ''}</div></div>
  <div class="step"><div class="step-no">1</div><div class="step-body"><h3>商品实拍图 <small>${p.references.length}/8 · 第一张为主参考</small></h3>
    <div class="refs">${p.references.map((r, i) => `<figure class="ref"><img src="${esc(file(r))}" alt="参考图 ${i + 1}">${i === 0 ? '<span class="badge">主参考</span>' : `<button class="ref-btn" title="设为主参考" onclick="primaryRef('${p.id}',${i})">设为主</button>`}<button class="ref-x" aria-label="删除参考图" onclick="removeRef('${p.id}',${i})">${icon('close')}</button></figure>`).join('')}
    ${p.references.length < 8 ? `<label class="drop ref-drop" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="dropRefs(event,'${p.id}')"><input type="file" accept="image/png,image/jpeg,image/webp" multiple onchange="uploadRefs('${p.id}',this.files)"><span>${icon('upload')}拖入或点击上传</span></label>` : ''}</div>
    <p class="hint">建议：正面清晰图 + 侧面 / 背面 + 材质细节 + 包装标签。实拍越清楚，生成的商品越准确。</p></div></div>
  <div class="step"><div class="step-no">2</div><div class="step-body"><h3>商品要点 <button class="link" onclick="editProduct('${p.id}')">编辑</button></h3>
    ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<span><small>${k}</small>${esc(v)}</span>`).join('')}</div>` : ''}
    ${sizeBlock(p)}
    <p class="${p.sellingPoints ? '' : 'muted'}">${esc(p.sellingPoints || '还没有填写卖点。写上已确认的卖点（例如“可拆洗”“防滑底”），图片上的文案会更准确；未知信息不会被编造。')}</p>${p.brand ? '' : '<p class="hint">首图可以展示品牌：如果商品或包装上有品牌，请在资料里填写；不填则不印品牌。</p>'}</div></div>
  ${colorStep(p)}
  <div class="step"><div class="step-no">4</div><div class="step-body"><h3>生成 AliExpress 素材包 <small>主图 6 · 营销图 2 · 备用 2 · 详情 9${p.variantsEnabled || p.sizesEnabled ? ' · ' + [p.variantsEnabled && '颜色', p.sizesEnabled && '尺寸'].filter(Boolean).join(' + ') + ' SKU 图（AI 识别）' : ''}</small></h3>
    <div class="chips">${PROMPT_CHIPS.map(c => `<button class="chip" onclick="addChip('${c}')">＋ ${c}</button>`).join('')}</div>
    <label class="field wide"><span>本次补充要求（可选）</span><textarea id="extra-prompt" rows="2" placeholder="例如：场景用米色沙发和木地板，保持商品真实颜色。"></textarea></label>
    <details class="style-note"><summary>统一风格（设置中修改）</summary><p>${esc(S.settings.style)}</p></details>
    ${miss.length ? `<div class="alert warn">缺少：${miss.join('、')}。请在<a href="#settings">设置</a>中检查。</div>` : ''}
    <div class="row-actions"><button class="primary big" ${job || !p.references.length || miss.length ? 'disabled' : ''} onclick="generateImages('${p.id}')">${icon('spark')}${job ? '正在制作…' : p.assetsReady ? '重新生成素材包' : '生成素材包'}</button>
    <span class="muted small-text">按 AliExpress 官方素材规范：主图九宫格 + 详情九宫格 + 3:4 营销图 → 裁切 → Real-ESRGAN。${p.petModel ? '所有图片使用同一只宠物：' + esc(p.petModel) : '宠物模特由 AI 选定，完成后自动记住，下次沿用。'}</span></div>
    ${job ? `<div class="live-box">${jobCard(job)}</div>` : last && ['failed', 'interrupted', 'cancelled'].includes(last.status) ? `<div class="live-box">${jobCard(last)}</div>` : ''}
  </div></div>
  ${p.assetsReady ? `<div class="step done"><div class="step-no">${icon('check')}</div><div class="step-body"><h3>最新成品 <button class="link" onclick="go('product','${p.id}')">在画廊查看全部 →</button></h3>
    <div class="mini-grid">${p.assets.map((a, i) => `<button class="mini" onclick="openBox('${p.id}',${i})"><img src="${esc(file(a.path))}" alt="${esc(a.name)}" loading="lazy"></button>`).join('')}</div>
    <p class="hint">${p.assetReview ? '✓ 已确认可用于上架' : '请在画廊中逐张检查，确认后才能自动存草稿。'}</p></div></div>` : ''}`;
}
function sizeBlock(p) {
  const sizes = [p.dimensions, p.sizeChart].filter(Boolean).join('\n');
  return sizes ? `<div class="size-box"><small>尺寸 / 尺码表 · 会原样标在 06 尺寸图、D3 参数图和 D8 尺码指南上</small><pre>${esc(sizes)}</pre></div>`
    : `<div class="alert warn">还没有填尺寸或尺码表：尺寸图只能画测量示意，不会标数字。<button class="link" onclick="editProduct('${p.id}')">去填写</button></div>`;
}
function colorStep(p) {
  const colors = (p.colors || []).map(c => c.name), sizes = (p.sizes || []).map(z => z.name);
  const toggle = (key, on, label, msg) => `<label class="switch"><input type="checkbox" ${on ? 'checked' : ''} onchange="act('products',{id:'${p.id}',${key}:this.checked},this.checked?'已开启${msg}':'已关闭${msg}')"> ${label}</label>`;
  const found = (title, list) => list.length ? `<div class="color-chips"><small>${title}</small>${list.map((n, i) => `<span class="pill ${i ? '' : 'ok'}">${i + 1}. ${esc(n)}</span>`).join('')}</div>` : '';
  const any = p.variantsEnabled || p.sizesEnabled;
  return `<div class="step"><div class="step-no">3</div><div class="step-body"><h3>颜色与尺寸 <small>可选 · AI 从实拍图识别</small></h3>
    ${toggle('variantsEnabled', p.variantsEnabled, '多颜色：为每个颜色生成一张白底 SKU 图', '多颜色')}
    ${p.variantsEnabled ? found('上次识别到的颜色：', colors) : ''}
    ${toggle('sizesEnabled', p.sizesEnabled, '多尺寸：为每个尺寸生成一张标好尺寸的 SKU 图', '多尺寸')}
    ${p.sizesEnabled ? found('上次识别到的尺寸：', sizes) : ''}
    <p class="hint">${any ? `不需要手动填写：AI 读取实拍图里的色块和尺寸表（例如供应商卡片）。尺码表里已填的尺寸优先。主图用第 1 个颜色；SKU 图先放在第三张图里（5 张），超过 5 张自动加第四张九宫格，最多 14 张。` : '都不勾选时，按实拍图本身的颜色作图，不生成 SKU 图。'}</p>
  </div></div>`;
}
function generateImages(id) { startJob(id, 'images', $('#extra-prompt')?.value || '') }
function addChip(text) { const t = $('#extra-prompt'); t.value = (t.value ? t.value.replace(/[，,\s]*$/, '，') : '') + text; t.focus() }
async function uploadRefs(id, files) {
  const list = [...files].filter(f => /image\/(png|jpeg|webp)/.test(f.type));
  if (!list.length) return toast('请选择 PNG、JPEG 或 WebP 图片', 'bad');
  try { for (const f of list) { if (f.size > 15 * 1024 * 1024) throw Error(f.name + ' 超过 15MB'); await api('reference', { id, data: await readFile(f) }) } await refresh(); toast(`已上传 ${list.length} 张实拍图`, 'ok') }
  catch (e) { toast(e.message, 'bad'); refresh() }
}
function dropRefs(e, id) { e.preventDefault(); uploadRefs(id, e.dataTransfer.files) }
function primaryRef(id, i) { const refs = [...product(id).references]; refs.unshift(...refs.splice(i, 1)); act('reference-order', { id, references: refs }, '已设为主参考') }
function removeRef(id, i) { const refs = product(id).references.filter((_, k) => k !== i); act('reference-order', { id, references: refs, remove: true }, '已移除参考图') }
async function batchImages() {
  let ok = 0;
  for (const id of ui.picked) { try { await api('jobs', { id, kind: 'images' }); ok++ } catch (e) { toast(product(id)?.sku + '：' + e.message, 'bad') } }
  ui.picked.clear(); await refresh(); if (ok) toast(`${ok} 个商品已加入作图队列，将依次制作`, 'ok');
}

/* ---------------------------------------------------------------- 2. gallery */
function galleryState(p) { return { all: true, images: p.assetsReady, todo: !p.assetsReady, pending: p.assetsReady && listedCount(p) < 3, listed: listedCount(p) === 3 } }
function gallery() {
  const filters = [['all', '全部'], ['images', '有图片'], ['todo', '待作图'], ['pending', '待上架'], ['listed', '三平台已上架']];
  const list = S.products.filter(p => galleryState(p)[ui.galleryFilter] && matches(p));
  const done = S.products.filter(p => p.assetsReady).length;
  return `<div class="page">
  <div class="page-head"><div><h1>画廊</h1><p class="muted">${S.products.length} 个商品 · ${done} 个已出图 · ${S.products.filter(p => listedCount(p) === 3).length} 个三平台已上架</p></div>
    <div class="row-actions"><button onclick="importDialog()">${icon('table')}从排期表导入</button><button class="primary" onclick="editProduct()">${icon('plus')}新建商品</button></div></div>
  <div class="toolbar"><input class="search" placeholder="搜索 SKU / 名称 / EAN / 品类" value="${esc(ui.search)}" oninput="searchInput(this.value)">
    <div class="segmented">${filters.map(([v, t]) => `<button class="${ui.galleryFilter === v ? 'on' : ''}" onclick="ui.galleryFilter='${v}';render()">${t}</button>`).join('')}</div></div>
  ${list.length ? `<div class="cards">${list.map(card).join('')}</div>` : S.products.length ? empty('没有符合条件的商品', '换个筛选或关键词试试。') : empty('画廊还是空的', '新建商品或从排期表导入，做好的图片和上架信息都会汇总在这里。', `<button class="primary" onclick="editProduct()">${icon('plus')}新建商品</button> <button onclick="importDialog()">${icon('table')}从排期表导入</button>`)}
  </div>`;
}
function statusDots(p) { return `<div class="dots">${S.platforms.map(s => { const st = p.listing?.[s]?.status || '待上架'; return `<span class="dot ${STATUS_TONE[st]}" title="${s}：${st}">${SHORT[s]}</span>` }).join('')}</div>` }
function card(p) {
  return `<a class="card" href="#product/${p.id}">
    <div class="card-img">${thumb(p)}${p.assetsReady ? `<span class="count-badge">${p.assets.length} 张</span>` : ''}<div class="card-live" data-live-card="${p.id}"></div></div>
    <div class="card-body"><b>${esc(displayName(p))}</b><small>${esc(p.sku)}${p.category ? ' · ' + esc(p.category) : ''}</small>
    <div class="card-foot">${p.assetsReady ? (p.assetReview ? pill('图片已确认', 'ok') : pill('图片待检查', 'warn')) : pill(p.references.length ? '待作图' : '缺实拍')}${statusDots(p)}</div></div></a>`;
}

/* ---------------------------------------------------------------- product page (gallery detail) */
function productPage() {
  const p = product(route.id);
  if (!p) return `<div class="page">${empty('商品不存在', '可能已被删除。', `<button onclick="go('gallery')">返回画廊</button>`)}</div>`;
  const tab = ['images', 'listing', 'info'].includes(route.sub) ? route.sub : 'images';
  const pendingEdits = jobsOf(p.id, 'edit').filter(j => j.status === 'completed' && j.edited && !Object.values(p.assetOverrides || {}).includes(j.edited));
  return `<div class="page">
  <div class="detail-head"><button class="icon" aria-label="返回画廊" onclick="go('gallery')">${icon('back')}</button>${thumb(p, 'head-thumb')}
    <div class="grow"><p class="eyebrow">${esc(p.sku)}${p.ean ? ' · EAN ' + esc(p.ean) : ''}</p><h1>${esc(displayName(p))}</h1><p class="muted">${esc(p.nameIt || '')}</p></div>
    <div class="row-actions"><button onclick="editProduct('${p.id}')">${icon('edit')}资料</button><button onclick="go('studio','${p.id}')">${icon('spark')}作图</button><button onclick="go('listing','${p.id}')">${icon('robot')}上架</button>${p.assetsReady ? `<button class="primary" onclick="download('/api/bundle?id=${p.id}')">${icon('down')}下载资料包</button>` : ''}</div></div>
  <div data-live-card="${p.id}"></div>
  <div class="tabs">${[['images', `图片 ${p.assets.length ? '<small>' + p.assets.length + '</small>' : ''}`], ['listing', '上架信息'], ['info', '商品资料']].map(([v, t]) => `<a href="#product/${p.id}/${v}" class="${tab === v ? 'on' : ''}">${t}</a>`).join('')}</div>
  ${tab === 'images' ? imagesTab(p, pendingEdits) : tab === 'listing' ? listingSummary(p) : infoTab(p)}
  </div>`;
}
function imagesTab(p, pendingEdits) {
  if (!p.assetsReady) return empty('还没有成品图', p.references.length ? '实拍图已就绪，去作图页生成素材包。' : '先上传商品实拍图，再生成上架图。', `<button class="primary" onclick="go('studio','${p.id}')">${icon('spark')}去作图</button>`);
  const group = (g, title, note) => { const items = p.assets.map((a, i) => [a, i]).filter(([a]) => a.group === g); return items.length ? `<section class="img-section"><div class="section-head"><h3>${title} <small>${items.length}</small></h3><span class="muted">${note}</span></div><div class="grid9">${items.map(([a, i]) => tile(p, a, i)).join('')}</div></section>` : '' };
  const groups = [['main', '主图', 'AliExpress 主图，按 01 → 06 顺序上传：正面 · 侧面 · 背面 · 细节 · 场景 · 尺寸'], ['marketing', '营销图', '1:1 白底（无文字）+ 3:4 场景'], ['variants', '颜色 SKU 图', '每个颜色一张白底图，上架时对应颜色款式'], ['sizes', '尺寸 SKU 图', '每个尺寸一张，图上标好该尺寸的数字'], ['extra', '备用图', '可替换主图，或用于其他平台'], ['detail', '详情图', '手机端详情模块，按 D1 → D9 放入商品描述'], ['listing', '商品图（旧版）', '01 白底主图适合 Amazon 主图；09 为 TikTok 场景图']];
  return `<div class="review-bar ${p.assetReview ? 'ok' : ''}"><label><input type="checkbox" ${p.assetReview ? 'checked' : ''} onchange="act('review',{id:'${p.id}',approved:this.checked},this.checked?'已确认图片可用于上架':'已取消确认')"> 我已逐张检查：商品外观、颜色、意大利语文字都正确，可用于上架</label><span class="muted">点击图片放大，← → 切换</span></div>
  ${pendingEdits.length ? `<section class="img-section"><div class="section-head"><h3>修改结果待确认 <small>${pendingEdits.length}</small></h3></div><div class="edits">${pendingEdits.map(j => { const a = p.assets.find(x => x.path === j.asset || x.originalPath === j.asset); return `<div class="edit-card"><div class="compare"><figure><img src="${esc(file(j.asset))}" alt=""><figcaption>原图</figcaption></figure><figure><img src="${esc(file(j.edited))}" alt=""><figcaption>修改后</figcaption></figure></div><p>${esc(j.extra)}</p><div class="row-actions">${a ? `<button class="small primary" onclick="act('adopt-edit',{id:'${p.id}',jobId:'${j.id}'},'已采用修改图')">采用修改图</button>` : '<span class="muted">原图已更换，无法采用</span>'}<a class="small-link" href="${esc(file(j.edited))}?download=1">下载</a></div></div>` }).join('')}</div></section>` : ''}
  ${groups.map(([g, t, n]) => group(g, t, g === 'detail' && p.assets.some(a => a.group === 'listing') ? 'AliExpress 商品描述中使用' : n)).join('')}
  ${p.boards.length ? `<details class="img-section boards"><summary><h3>九宫格原图 <small>${p.boards.length}</small></h3></summary><div class="grid2">${p.boards.map(b => `<a href="${esc(file(b))}" target="_blank"><img src="${esc(file(b))}" alt="九宫格原图" loading="lazy"></a>`).join('')}</div></details>` : ''}`;
}
function tile(p, a, i) {
  return `<figure class="tile ${a.ratio === "3:4" ? "tall" : ""}"><button class="tile-img" onclick="openBox('${p.id}',${i})" aria-label="放大 ${esc(a.name)}"><img src="${esc(file(a.path))}" alt="${esc(a.name)}" loading="lazy"></button>
    <figcaption><span>${esc(a.name.replace(/\.(png|jpe?g)$/i, ''))}</span>${a.edited ? pill('已修改', 'info') : ''}</figcaption><small>${esc(a.use)}</small>
    <div class="tile-actions"><a href="${esc(file(a.path))}?download=1" title="下载" aria-label="下载">${icon('down')}</a><button title="局部修改" aria-label="局部修改" onclick="openBox('${p.id}',${i},true)">${icon('edit')}</button></div></figure>`;
}
function listingSummary(p) {
  return `<div class="summary-grid">${S.platforms.map(s => { const l = p.listing[s], lim = S.limits[s] || {}; return `<section class="summary-card">
    <div class="section-head"><h3>${s}</h3>${pill(l.status, STATUS_TONE[l.status])}</div>
    ${l.title ? `<div class="copyable"><label>标题 <small>${l.title.length}/${lim.title}</small></label><p class="title-text">${esc(l.title)}</p><p class="muted">${esc(l.titleZh)}</p><button class="icon small" aria-label="复制标题" onclick="copyText(product('${p.id}').listing['${s}'].title,'标题')">${icon('copy')}</button></div>
    ${l.bullets.length ? `<div class="copyable"><label>卖点</label><ul>${l.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul><button class="icon small" aria-label="复制卖点" onclick="copyText(product('${p.id}').listing['${s}'].bullets.join('\\n'),'卖点')">${icon('copy')}</button></div>` : ''}
    <div class="copyable"><label>描述</label><p class="desc">${esc(l.description)}</p><button class="icon small" aria-label="复制描述" onclick="copyText(product('${p.id}').listing['${s}'].description,'描述')">${icon('copy')}</button></div>
    ${(l.attributes || []).length ? `<div class="copyable"><label>商品属性</label><dl class="attr-list">${l.attributes.map(a => `<dt>${esc(a.name)}${a.nameZh ? ' · ' + esc(a.nameZh) : ''}</dt><dd>${esc(a.value)}</dd>`).join('')}</dl><button class="icon small" aria-label="复制属性" onclick="copyText(product('${p.id}').listing['${s}'].attributes.map(a=>a.name+': '+a.value).join('\\n'),'属性')">${icon('copy')}</button></div>` : ''}
    ${l.keywords ? `<div class="copyable"><label>后台关键词</label><p>${esc(l.keywords)}</p><button class="icon small" aria-label="复制关键词" onclick="copyText(product('${p.id}').listing['${s}'].keywords,'关键词')">${icon('copy')}</button></div>` : ''}` : `<p class="muted">还没有文案。</p>`}
    <div class="kv"><span>原价 <b>${money(l.price)}</b></span><span>促销价 <b>${money(l.promoPrice)}</b></span></div>
    ${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noreferrer">查看平台商品 ↗</a>` : l.productId ? `<p class="muted">商品 / 草稿 ID：${esc(l.productId)}</p>` : ''}
    <button class="small" onclick="go('listing','${p.id}','${s}')">编辑 ${s} →</button></section>` }).join('')}</div>
    ${p.toVerify?.length ? `<div class="alert warn"><b>上架前需核实：</b>${p.toVerify.map(esc).join('；')}</div>` : ''}`;
}
function infoTab(p) {
  const rows = [['SKU', p.sku], ['EAN', p.ean], ['中文名称', p.nameZh], ['意大利语名称', p.nameIt], ['品牌', p.brand], ['品类', p.category], ['尺寸', p.dimensions], ['重量', p.weight], ['材质', p.material], ['颜色', p.variantsEnabled ? (p.colors || []).map(c => c.name).join('、') : p.color], ['尺码表', p.sizeChart], ['识别到的尺寸', p.sizesEnabled ? (p.sizes || []).map(z => z.name).join('、') : ''], ['宠物模特', p.petModel], ['库存', p.stock], ['税前进货价', p.cost == null ? '' : money(p.cost)], ['卖点', p.sellingPoints], ['包装内容', p.packageContents], ['意大利语简介', p.descriptionIt], ['中文简介', p.descriptionZh]];
  return `<div class="info-grid"><dl class="facts-list">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v === '' || v == null ? '<span class="muted">—</span>' : esc(v)}</dd>`).join('')}</dl>
  <section><h3>实拍参考图</h3><div class="refs">${p.references.map(r => `<a class="ref" href="${esc(file(r))}" target="_blank"><img src="${esc(file(r))}" alt=""></a>`).join('') || '<p class="muted">暂无</p>'}</div>
  <h3>任务记录</h3>${jobsOf(p.id).slice(0, 12).map(j => jobCard(j, true)).join('') || '<p class="muted">暂无</p>'}</section></div>`;
}

/* ---------------------------------------------------------------- lightbox */
function openBox(id, index, edit = false) { ui.box = { id, index, edit }; renderLightbox(); document.addEventListener('keydown', boxKeys) }
function closeBox() { ui.box = null; $('#lightbox').hidden = true; $('#lightbox').innerHTML = ''; document.removeEventListener('keydown', boxKeys) }
function boxKeys(e) {
  if (!ui.box || e.target.matches('textarea,input')) return;
  if (e.key === 'Escape') closeBox();
  if (e.key === 'ArrowRight') moveBox(1);
  if (e.key === 'ArrowLeft') moveBox(-1);
}
function moveBox(step) { const p = product(ui.box.id); ui.box.index = (ui.box.index + step + p.assets.length) % p.assets.length; ui.box.edit = false; renderLightbox() }
function renderLightbox() {
  const p = product(ui.box.id); if (!p || !p.assets.length) return closeBox();
  const a = p.assets[ui.box.index] || p.assets[0], running = jobsOf(p.id, 'edit').find(j => ACTIVE(j) && (j.asset === a.path || j.asset === a.originalPath));
  const lb = $('#lightbox'); lb.hidden = false;
  lb.innerHTML = `<div class="lb-backdrop" onclick="closeBox()"></div>
  <div class="lb-panel" role="dialog" aria-label="图片预览">
    <div class="lb-stage"><button class="lb-nav left" aria-label="上一张" onclick="moveBox(-1)">${icon('left')}</button><img src="${esc(file(a.path))}" alt="${esc(a.name)}"><button class="lb-nav right" aria-label="下一张" onclick="moveBox(1)">${icon('right')}</button></div>
    <div class="lb-side"><div class="lb-top"><span>${ui.box.index + 1} / ${p.assets.length}</span><button class="icon" aria-label="关闭" onclick="closeBox()">${icon('close')}</button></div>
      <h3>${esc(a.name)}</h3><p class="muted">${esc(a.use)} · ${esc(a.size || '1000×1000')}</p>
      <div class="row-actions"><a class="button" href="${esc(file(a.path))}?download=1">${icon('down')}下载</a>${a.edited ? `<button onclick="act('revert-asset',{id:'${p.id}',originalPath:'${esc(a.originalPath)}'},'已恢复原图')">恢复原图</button>` : ''}</div>
      <div class="lb-edit"><h4>局部修改</h4><p class="muted">只改你描述的部分，商品和其他区域保持不变；原图始终保留。</p>
        <textarea id="lb-edit-text" rows="4" placeholder="例如：把右上角的文字改成 “Lavabile in lavatrice”，其他不变。" ${ui.box.edit ? 'autofocus' : ''}></textarea>
        <button class="primary" ${running ? 'disabled' : ''} onclick="submitEdit('${p.id}','${esc(a.path)}')">${running ? '修改中…' : '生成修改版本'}</button>
        ${running ? `<div class="live-box">${jobCard(running, true)}</div>` : ''}</div>
      <div class="lb-strip">${p.assets.map((x, i) => `<button class="${i === ui.box.index ? 'on' : ''}" onclick="ui.box.index=${i};renderLightbox()"><img src="${esc(file(x.path))}" alt="" loading="lazy"></button>`).join('')}</div>
    </div></div>`;
  if (ui.box.edit) setTimeout(() => $('#lb-edit-text')?.focus(), 30);
}
async function submitEdit(id, path) { const t = $('#lb-edit-text').value.trim(); if (!t) return toast('请描述要修改的内容'); await startJob(id, 'edit', t, path); if (ui.box) renderLightbox() }

/* ---------------------------------------------------------------- 3. listing */
function listingView() {
  const p = product(route.id);
  return p ? listingEditor(p) : listingBoard();
}
function listingBoard() {
  const filters = [['all', '全部'], ['todo', '未开始'], ['partial', '部分上架'], ['done', '三平台已上架']];
  const pass = p => ({ all: true, todo: listedCount(p) === 0, partial: listedCount(p) > 0 && listedCount(p) < 3, done: listedCount(p) === 3 })[ui.listingFilter];
  const list = S.products.filter(p => pass(p) && matches(p));
  return `<div class="page">
  <div class="page-head"><div><h1>上架中心</h1><p class="muted">三平台文案、价格与上架状态。点击平台状态进入编辑。</p></div>
    <div class="row-actions"><button onclick="go('settings')">${icon('robot')}自动上架说明</button></div></div>
  <div class="toolbar"><input class="search" placeholder="搜索 SKU / 名称" value="${esc(ui.search)}" oninput="searchInput(this.value)">
    <div class="segmented">${filters.map(([v, t]) => `<button class="${ui.listingFilter === v ? 'on' : ''}" onclick="ui.listingFilter='${v}';render()">${t}</button>`).join('')}</div></div>
  ${list.length ? `<div class="table-wrap"><table class="board"><thead><tr><th>商品</th><th>图片</th><th>文案</th>${S.platforms.map(s => `<th>${s}</th>`).join('')}<th></th></tr></thead><tbody>
  ${list.map(p => `<tr><td><a class="prod" href="#listing/${p.id}">${thumb(p, 'qthumb')}<span><b>${esc(displayName(p))}</b><small>${esc(p.sku)}</small></span></a></td>
    <td>${p.assetsReady ? (p.assetReview ? pill('已确认', 'ok') : pill('待检查', 'warn')) : pill('未出图')}</td>
    <td>${activeJob(p.id, ['copy']) ? pill('生成中', 'info') : hasCopy(p) ? pill('已有', 'ok') : pill('未生成')}</td>
    ${S.platforms.map(s => { const l = p.listing[s]; return `<td><a class="status-cell" href="#listing/${p.id}/${encodeURIComponent(s)}">${pill(l.status, STATUS_TONE[l.status])}<small>${l.promoPrice || l.price ? money(l.promoPrice || l.price) : '未定价'}</small></a></td>` }).join('')}
    <td><a class="button small" href="#listing/${p.id}">编辑</a></td></tr>`).join('')}</tbody></table></div>` : empty('没有商品', S.products.length ? '换个筛选试试。' : '先在画廊新建或导入商品。')}
  </div>`;
}
function listingEditor(p) {
  const platform = S.platforms.includes(route.sub) ? route.sub : 'AliExpress', l = p.listing[platform], lim = S.limits[platform] || {};
  const copyJob = activeJob(p.id, ['copy']), lastCopy = jobsOf(p.id, 'copy')[0];
  const counter = (key, value, limit, useBytes) => limit ? `<small class="counter" data-counter="${key}" data-limit="${limit}" data-bytes="${useBytes ? 1 : 0}">${useBytes ? bytes(value) : (value || '').length}/${limit}${useBytes ? ' 字节' : ''}</small>` : '';
  const bulletsCount = lim.bullets || 0;
  const bullets = Array.from({ length: bulletsCount }, (_, i) => l.bullets[i] || '');
  const legacy = p.assets.some(a => a.group === 'listing');
  const by = (g, pre = '') => p.assets.filter(a => a.group === g && a.name.startsWith(pre));
  const order = legacy ? { AliExpress: '主图 01–08 按顺序上传；详情图 D1–D9 放入商品描述。', Amazon: '01 白底图作为主图，02–08 作为附图。', 'TikTok Shop': '01–09 作为商品图，09 为场景营销图。' }[platform]
    : { AliExpress: '主图 01–06 按顺序上传；营销图放 1:1 白底和 3:4 场景两个位置；颜色 SKU 图（V01…）、尺寸 SKU 图（S01…）对应各款式；详情图 D1–D9 放入描述。', Amazon: 'Amazon 主图必须纯白底无文字：用营销图 1:1 白底做主图，主图 02–06 做附图。', 'TikTok Shop': '主图 01–06 作为商品图，3:4 场景图可作为竖版展示图。' }[platform];
  const images = legacy ? p.assets.filter(a => platform === 'AliExpress' ? true : a.group === 'listing').filter(a => platform !== 'Amazon' || !a.name.startsWith('09'))
    : platform === 'AliExpress' ? [...by('main'), ...by('marketing'), ...by('variants'), ...by('sizes'), ...by('detail')]
    : platform === 'Amazon' ? [...by('marketing', 'white'), ...by('main').slice(1), ...by('extra', '07')]
    : [...by('main'), ...by('marketing', 'scene')];
  const shortName = a => ({ white_1x1: '白底', scene_3x4: '3:4' }[a.name.replace(/\.\w+$/, '')] || a.name.slice(0, 3).replace(/_$/, ''));
  return `<div class="page">
  <div class="detail-head"><button class="icon" aria-label="返回上架中心" onclick="go('listing')">${icon('back')}</button>${thumb(p, 'head-thumb')}
    <div class="grow"><p class="eyebrow">${esc(p.sku)}${p.ean ? ' · EAN ' + esc(p.ean) : ''}</p><h1>${esc(displayName(p))}</h1><p class="muted">${esc(p.nameIt || '')}</p></div>
    <div class="row-actions"><button onclick="go('product','${p.id}','listing')">在画廊查看</button>${p.assetsReady ? `<button onclick="download('/api/bundle?id=${p.id}')">${icon('down')}资料包</button>` : ''}</div></div>
  <div class="ai-bar"><div><b>${icon('spark')} AI 生成三平台意大利语文案</b><p class="muted">根据商品资料和实拍图，一次写好 AliExpress / Amazon / TikTok 的标题、卖点、描述${hasCopy(p) ? '。会覆盖三个平台当前的标题、卖点、描述和关键词（价格与状态不变）' : ''}。</p></div>
    <input id="copy-extra" placeholder="补充要求（可选），如：强调可机洗" ${copyJob ? 'disabled' : ''}><button class="primary" ${copyJob ? 'disabled' : ''} onclick="generateCopy('${p.id}')">${copyJob ? '生成中…' : hasCopy(p) ? '重新生成' : '生成文案'}</button></div>
  ${copyJob ? `<div class="live-box">${jobCard(copyJob)}</div>` : lastCopy && lastCopy.status === 'failed' ? `<div class="live-box">${jobCard(lastCopy)}</div>` : ''}
  ${p.toVerify?.length ? `<div class="alert warn"><b>上架前需核实：</b>${p.toVerify.map(esc).join('；')}</div>` : ''}
  <div class="tabs">${S.platforms.map(s => `<a href="#listing/${p.id}/${encodeURIComponent(s)}" class="${s === platform ? 'on' : ''}">${s} ${pill(p.listing[s].status, STATUS_TONE[p.listing[s].status])}</a>`).join('')}</div>
  <div class="editor">
    <form class="editor-main" id="listing-form" data-id="${p.id}" data-platform="${esc(platform)}" oninput="listingInput(event)" onchange="listingInput(event,true)" onsubmit="event.preventDefault()">
      <div class="save-state" id="save-state">${l.updatedAt ? '已保存 · ' + new Date(l.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '修改会自动保存'}</div>
      <div class="field wide"><div class="label-row"><span>标题</span>${counter('title', l.title, lim.title)}<button type="button" class="icon small" aria-label="复制标题" onclick="copyText($('[name=title]').value,'标题')">${icon('copy')}</button></div><textarea name="title" rows="2">${esc(l.title)}</textarea></div>
      <label class="field wide"><span>中文对照（仅供核对，不上传）</span><input name="titleZh" value="${esc(l.titleZh)}"></label>
      ${bulletsCount ? `<div class="field wide"><div class="label-row"><span>卖点（${bulletsCount} 条）</span><button type="button" class="icon small" aria-label="复制全部卖点" onclick="copyText($$('[name=bullet]').map(x=>x.value).filter(Boolean).join('\\n'),'卖点')">${icon('copy')}</button></div>
        ${bullets.map((b, i) => `<div class="bullet"><span>${i + 1}</span><textarea name="bullet" rows="2">${esc(b)}</textarea>${counter('bullet' + i, b, lim.bullet)}</div>`).join('')}</div>` : ''}
      <div class="field wide"><div class="label-row"><span>商品描述</span>${counter('description', l.description, lim.description)}<button type="button" class="icon small" aria-label="复制描述" onclick="copyText($('[name=description]').value,'描述')">${icon('copy')}</button></div><textarea name="description" rows="9">${esc(l.description)}</textarea></div>
      ${lim.keywords ? `<div class="field wide"><div class="label-row"><span>后台搜索关键词</span>${counter('keywords', l.keywords, lim.keywords, true)}<button type="button" class="icon small" aria-label="复制关键词" onclick="copyText($('[name=keywords]').value,'关键词')">${icon('copy')}</button></div><input name="keywords" value="${esc(l.keywords)}"></div>` : ''}
      <div class="field wide"><div class="label-row"><span>商品属性（每行一条：名称: 值）</span><button type="button" class="icon small" aria-label="复制属性" onclick="copyText($('[name=attributes]').value,'属性')">${icon('copy')}</button></div><textarea name="attributes" rows="5" placeholder="Materiale: Acrilico&#10;Tipo di animale: Cane">${esc((l.attributes || []).map(a => a.name + ': ' + a.value).join('\n'))}</textarea><small>AI 生成文案时一起生成，只包含已核实的属性；上架时对照平台表单填写。</small></div>
      <div class="form-grid">
        <label class="field"><span>原价 €（含税）</span><input name="price" type="number" min="0" step="0.01" value="${l.price ?? ''}"></label>
        <label class="field"><span>促销价 €</span><input name="promoPrice" type="number" min="0" step="0.01" value="${l.promoPrice ?? ''}"></label>
        <label class="field"><span>上架状态</span><select name="status">${S.statuses.map(s => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field"><span>平台商品 ID / 草稿 ID</span><input name="productId" value="${esc(l.productId)}"></label>
        <label class="field wide"><span>平台商品链接</span><input name="url" type="url" placeholder="https://" value="${esc(l.url)}"></label>
      </div>
    </form>
    <aside class="editor-side">
      ${autoPanel(p, platform)}
      <section class="side-card"><h3>本平台图片 <small>${images.length}</small></h3><p class="muted">${order}</p>
        ${images.length ? `<div class="side-grid">${images.map(a => `<a href="${esc(file(a.path))}?download=1" title="下载 ${esc(a.name)}"><img src="${esc(file(a.path))}" alt="${esc(a.name)}" loading="lazy"><span>${esc(shortName(a))}</span></a>`).join('')}</div><button class="small" onclick="download('/api/bundle?id=${p.id}')">${icon('down')}下载全部（资料包）</button>` : `<p>还没有图片。<a href="#studio/${p.id}">去作图 →</a></p>`}</section>
      <section class="side-card"><h3>商品事实</h3><dl class="mini-facts">${[['EAN', p.ean], ['尺寸', p.dimensions], ['重量', p.weight], ['材质', p.material], ['库存', p.stock]].map(([k, v]) => `<dt>${k}</dt><dd>${v === '' || v == null ? '<span class="muted">—</span>' : esc(v)}</dd>`).join('')}</dl><button class="small" onclick="editProduct('${p.id}')">${icon('edit')}编辑资料</button></section>
    </aside>
  </div></div>`;
}
function autoPanel(p, platform) {
  const c = S.capabilities, l = p.listing[platform];
  if (platform !== 'AliExpress') return `<section class="side-card auto"><h3>${icon('robot')} 自动上架</h3><p>${platform} 的自动上架需要官方接口：${platform === 'Amazon' ? 'Amazon SP-API（Listings Items API），需在 Seller Central 注册私有开发者应用并自授权。' : 'TikTok Shop Partner Center 的 Custom App，需申请商品管理权限并通过审核。'}</p><p class="muted">授权到位后可接入本系统。现在可用“复制”按钮和资料包手动上架，完成后把状态改为“已上架”。</p><a class="small-link" href="#settings">查看完整方案 →</a></section>`;
  const checks = [['图片已确认', p.assetsReady && p.assetReview], ['标题与描述', !!(l.title && l.description)], ['售价与库存', !!(l.price && p.stock)], ['发布技能', c.publishSkill], ['Codex 浏览器（Playwright MCP）', c.playwright]];
  const ready = checks.every(x => x[1]), job = activeJob(p.id, ['publish']), last = jobsOf(p.id, 'publish')[0];
  return `<section class="side-card auto"><h3>${icon('robot')} 自动存草稿 <span class="pill info">实验</span></h3>
    <p class="muted">Codex 打开你已登录的卖家后台，按 ecom-aliexpress-publish 技能填写表单，<b>只保存草稿，不会发布</b>。欧盟责任人和制造商需你手动选择。</p>
    <ul class="checks">${checks.map(([t, ok]) => `<li class="${ok ? 'ok' : ''}">${ok ? icon('check') : '○'} ${t}</li>`).join('')}</ul>
    <button class="primary" ${!ready || job ? 'disabled' : ''} onclick="startJob('${p.id}','publish','','','AliExpress')">${job ? '正在填写…' : '自动存为 AliExpress 草稿'}</button>
    ${!c.playwright ? `<p class="hint">未检测到 Playwright MCP。<a href="#settings">查看配置步骤</a></p>` : ''}
    ${job ? jobCard(job, true) : last && last.status !== 'completed' ? jobCard(last, true) : ''}</section>`;
}
function generateCopy(id) { startJob(id, 'copy', $('#copy-extra')?.value || '') }
function listingInput(e, immediate = false) {
  const form = $('#listing-form'); if (!form) return;
  const t = e.target;
  if (t.dataset && t.name) {
    const c = t.name === 'bullet' ? form.querySelectorAll('[data-counter^=bullet]')[[...form.querySelectorAll('[name=bullet]')].indexOf(t)] : form.querySelector(`[data-counter="${t.name}"]`);
    if (c) { const n = c.dataset.bytes === '1' ? bytes(t.value) : t.value.length, lim = +c.dataset.limit; c.textContent = `${n}/${lim}${c.dataset.bytes === '1' ? ' 字节' : ''}`; c.classList.toggle('over', n > lim) }
  }
  $('#save-state').textContent = '未保存…';
  clearTimeout(ui.saveTimer);
  ui.saveTimer = setTimeout(saveListing, immediate ? 0 : 800);
}
async function saveListing() {
  const form = $('#listing-form'); if (!form) return;
  const id = form.dataset.id, platform = form.dataset.platform, f = new FormData(form);
  const fields = { title: f.get('title'), titleZh: f.get('titleZh'), description: f.get('description'), price: f.get('price'), promoPrice: f.get('promoPrice'), status: f.get('status'), productId: f.get('productId'), url: f.get('url') };
  if (form.querySelector('[name=bullet]')) fields.bullets = f.getAll('bullet');
  if (form.querySelector('[name=keywords]')) fields.keywords = f.get('keywords');
  if (form.querySelector('[name=attributes]')) fields.attributes = f.get('attributes');
  try {
    const p = await api('listing', { id, platform, fields });
    const i = S.products.findIndex(x => x.id === id); if (i >= 0) S.products[i] = { ...S.products[i], listing: p.listing };
    $('#save-state').textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    $('#save-state').className = 'save-state';
  } catch (e) { $('#save-state').textContent = '未保存：' + e.message; $('#save-state').className = 'save-state bad' }
}

/* ---------------------------------------------------------------- settings */
function settingsView() {
  const s = S.settings, c = S.capabilities;
  const row = (label, ok, note = '') => `<div class="check-row"><span>${label}${note ? `<small>${note}</small>` : ''}</span>${pill(ok ? '已就绪' : '未检测到', ok ? 'ok' : 'bad')}</div>`;
  return `<div class="page narrow">
  <div class="page-head"><div><h1>设置</h1><p class="muted">数据保存在本机 data 目录，服务只监听 127.0.0.1。</p></div><div class="row-actions"><button onclick="download('/api/backup')">${icon('down')}导出完整备份</button></div></div>
  <form class="panel" id="settings-form"><h2>风格</h2>
    <label class="field wide"><span>图片统一风格（作图时附加）</span><textarea name="style" rows="3">${esc(s.style)}</textarea></label>
    <label class="field wide"><span>文案语气（意大利语文案生成时附加）</span><textarea name="copyStyle" rows="2">${esc(s.copyStyle)}</textarea></label>
    <h2>AliExpress 默认值</h2><div class="form-grid">
    <label class="field"><span>发货仓库</span><input name="aeWarehouse" value="${esc(s.aeWarehouse)}"></label>
    <label class="field"><span>运费模板</span><input name="aeShippingTemplate" value="${esc(s.aeShippingTemplate)}"></label></div>
    <label class="field wide"><span>售后 & 服务提示（详情图 D7 只会使用这里写的内容，意大利语）</span><textarea name="servicePoints" rows="3" placeholder="例如：Spedizione dal magazzino in Italia; Assistenza clienti in italiano">${esc(s.servicePoints || '')}</textarea><small>只写你确实提供的服务。留空时 D7 只放中性提示（例如“尺码有疑问请先咨询”），不会编造退货期限或保修。</small></label>
    <h2>Codex</h2><label class="field wide"><span>Codex 模型（可选）</span><input name="codexModel" value="${esc(s.codexModel || '')}" placeholder="留空 = 使用 ~/.codex/config.toml 的默认模型"><small>如果任务报错“model is not supported when using Codex with a ChatGPT account”，在这里填一个你的账号可用的模型名。</small></label>
    <div class="form-actions"><span></span><button class="primary" type="submit">保存设置</button></div></form>
  <section class="panel"><h2>本机引擎</h2>
    ${row('Codex 程序', c.codex, '使用你的 ChatGPT 登录，不需要 API Key')}${row('九宫格电商法技能', c.skill)}${row('裁剪与输出脚本', c.finalizer)}${row('Real-ESRGAN 高清化', c.upscaler)}
    ${row('ecom-aliexpress-publish 技能', c.publishSkill)}${row('Codex Playwright MCP（浏览器自动化）', c.playwright, '每 5 分钟检测一次')}</section>
  <section class="panel" id="auto"><h2>三平台自动上架：可行性与路线</h2>
    <div class="route"><h3>AliExpress · 现在可用（实验）</h3><p>路线：Codex + Playwright MCP 操作你已登录的卖家后台，按 ecom-aliexpress-publish 技能填表并<b>保存草稿</b>，人工检查后再发布。不需要平台审批，但页面改版会导致失败，需要维护。</p>
      <p>配置步骤（一次）：</p><ol><li>在终端运行 <code>npm install -g @playwright/mcp@latest</code> 和 <code>npx playwright install chromium</code></li>
      <li>在 <code>~/.codex/config.toml</code> 添加：<pre>[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--browser=chromium", "--user-data-dir=${esc('C:/Users/你的用户名/.pw-profile')}"]</pre></li>
      <li>运行 <code>codex mcp list</code> 确认出现 playwright；然后用这个浏览器配置手动登录一次卖家后台（本系统从不输入密码）。</li></ol>
      <p class="muted">备选：AliExpress 批量上传表格——你的 ecom-json-to-upload-xlsx 技能可以把资料包中的 listing.json 填进官方模板；图片需先有可访问的 URL。</p></div>
    <div class="route"><h3>Amazon.it · 可行，需要授权</h3><p>官方 Selling Partner API 的 Listings Items API（putListingsItem）可以创建和更新商品，图片通过 URL 提交。需要专业卖家账号，在 Seller Central 注册<b>私有开发者</b>应用并自授权。接入前要为你的品类拉取 Product Type 定义做字段映射；图片需要公网 URL（可用图床或对象存储）。</p></div>
    <div class="route"><h3>TikTok Shop 意大利 · 可行，需要审批</h3><p>TikTok Shop Partner Center 创建 Custom App，申请商品管理权限，审核通过后可用 Product API 上传图片、创建商品。审批通常数个工作日，意大利站点的具体类目属性需按接口返回的类目规则填写。</p></div>
    <p class="muted">建议顺序：先用 AliExpress 草稿自动化跑通（你的主平台，不用审批）→ 同时申请 Amazon SP-API 私有开发者 → 再申请 TikTok Custom App。授权下来后，本系统的 listing 数据结构已经可以直接映射到三个接口。</p></section>
  </div>`;
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'settings-form') return;
  e.preventDefault(); act('settings', Object.fromEntries(new FormData(e.target)), '设置已保存');
});

/* ---------------------------------------------------------------- boot */
async function poll() {
  if (ui.pollBusy) return; ui.pollBusy = true;
  const before = S.jobs.filter(ACTIVE).map(j => j.id);
  try {
    await refresh(false);
    const finished = before.some(id => !S.jobs.some(j => j.id === id && ACTIVE(j)));
    if (finished && !editing()) render(); else { renderNav(); renderTasks(); renderLive() }
  } finally { ui.pollBusy = false; setTimeout(poll, S.jobs.some(ACTIVE) ? 3000 : 10000) }
}
window.addEventListener('hashchange', () => { readHash(); closeBox(); window.scrollTo(0, 0); render() });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && $('#listing-form')) { e.preventDefault(); clearTimeout(ui.saveTimer); saveListing() }
});
readHash();
refresh().then(() => setTimeout(poll, 3000));
