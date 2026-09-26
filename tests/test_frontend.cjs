// Renders every view of web/app.js in a minimal fake DOM: catches runtime errors and missing escaping.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const elements = new Map();
const el = s => {
  if (!elements.has(s)) elements.set(s, { innerHTML: '', textContent: '', className: '', hidden: false, style: {}, dataset: {}, classList: { toggle() {} }, setAttribute() {}, open: false, showModal() { this.open = true }, close() { this.open = false }, focus() {}, setSelectionRange() {}, querySelector() { return null }, querySelectorAll() { return [] } });
  return elements.get(s);
};
const listing = (status, title = '') => ({ title, titleZh: '', bullets: title ? ['<b>x</b>'] : [], description: title, keywords: '', price: 19.99, promoPrice: null, status, productId: '', url: '', updatedAt: null });
const evil = '<img src=x onerror=alert(1)>';
const initial = {
  products: [
    { id: 'p1', sku: 'CAT-1', nameZh: evil, nameIt: 'Cuccia', ean: '', references: ['references/a.jpg'], assetsReady: true, assetReview: false, assetOverrides: {}, toVerify: ['材质'],
      assets: Array.from({ length: 18 }, (_, i) => ({ name: (i < 9 ? `0${i + 1}_x` : `D${i - 8}_x`) + '.jpg', path: `runs/j/${i < 9 ? 'listing' : 'detail'}/${i}.jpg`, originalPath: `runs/j/${i}.jpg`, group: i < 9 ? 'listing' : 'detail', use: '通用', edited: false })),
      boards: ['runs/j/masters/M1.png'], listing: { AliExpress: listing('草稿', 'Cuccia ' + evil), Amazon: listing('已上架', 'T'), 'TikTok Shop': listing('待上架') } },
    { id: 'p3', sku: 'V2-3', nameZh: '毛衣', nameIt: 'Maglione', petModel: 'Barboncino toy', sizeChart: 'S: schiena 25 cm', variantsEnabled: true, sizesEnabled: true, sizes: [{ name: 'L · 110 × 80 cm' }], colors: [{ name: 'Rosso', ref: 'references/b.jpg' }, { name: '<b>Blu</b>', ref: '' }], references: ['references/b.jpg'], assetsReady: true, assetReview: true, assetOverrides: {},
      assets: [...['01_front.jpg', '02_side.jpg', '03_back.jpg', '04_detail.jpg', '05_scene.jpg', '06_size.png'].map(n => ({ name: n, group: 'main', use: '主图', ratio: '1:1', size: '1000×1000' })),
        { name: 'white_1x1.jpg', group: 'marketing', use: '白底', ratio: '1:1', size: '1000×1000' }, { name: 'scene_3x4.jpg', group: 'marketing', use: '3:4', ratio: '3:4', size: '900×1200' },
        { name: '07_selling_points.png', group: 'extra', use: '备用', ratio: '1:1' }, { name: 'S01_l.jpg', group: 'sizes', use: '尺寸 SKU 图 · L', ratio: '1:1' }, ...Array.from({ length: 9 }, (_, i) => ({ name: `D${i + 1}_x.png`, group: 'detail', use: '详情', ratio: '1:1' }))].map(a => ({ ...a, path: 'runs/v2/' + a.group + '/' + a.name, originalPath: 'runs/v2/' + a.group + '/' + a.name, edited: false })),
      boards: ['runs/v2/masters/M1.png', 'runs/v2/masters/M3.png'], listing: { AliExpress: { ...listing('草稿', 'Maglione'), attributes: [{ name: 'Materiale', value: 'Acrilico', nameZh: '材质' }] }, Amazon: listing('待上架'), 'TikTok Shop': listing('待上架') } },
    { id: 'p2', sku: 'DOG-2', nameZh: '狗窝', nameIt: '', references: [], assets: [], boards: [], assetsReady: false, listing: { AliExpress: listing('待上架'), Amazon: listing('待上架'), 'TikTok Shop': listing('待上架') } },
  ],
  jobs: [{ id: 'j1', productId: 'p1', sku: 'CAT-1', kind: 'images', status: 'running', createdAt: '2026-09-26T10:00:00Z', message: evil, folder: 'runs/j1', progress: { percent: 38, label: '已生成 1 / 2 张九宫格', elapsedSeconds: 75 } },
         { id: 'j2', productId: 'p1', sku: 'CAT-1', kind: 'edit', status: 'completed', createdAt: '2026-09-26T09:00:00Z', message: 'ok', asset: 'runs/j/listing/2.jpg', edited: 'runs/e/edited.png', extra: evil, progress: { percent: 100, label: '完成' } }],
  settings: { style: 's', copyStyle: 'c', aeWarehouse: 'W', aeShippingTemplate: 'T' },
  capabilities: { codex: true, skill: true, upscaler: true, finalizer: true, publishSkill: true, playwright: false },
  platforms: ['AliExpress', 'Amazon', 'TikTok Shop'], statuses: ['待上架', '草稿', '审核中', '已上架', '被拒', '已下架'],
  limits: { AliExpress: { title: 128, bullets: 0, description: 5000, keywords: 0 }, Amazon: { title: 200, bullets: 5, bullet: 250, description: 2000, keywords: 250 }, 'TikTok Shop': { title: 255, bullets: 5, bullet: 250, description: 10000, keywords: 0 } },
};
const location = { hash: '', origin: 'http://127.0.0.1:3310' };
const ctx = {
  console, location, URL, Intl, Date, Set, Map, TextEncoder, FormData: class {}, setTimeout: () => 0, clearTimeout() {},
  document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }, activeElement: null, title: '' },
  window: { addEventListener() {}, scrollTo() {} },
  fetch: async () => ({ ok: true, json: async () => initial }),
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('web/app.js', 'utf8'), ctx);
setImmediate(() => {
  const routes = ['gallery', 'studio', 'studio/p1', 'studio/p2', 'product/p1', 'product/p1/listing', 'product/p1/info', 'product/p2', 'product/missing',
    'studio/p3', 'product/p3', 'product/p3/listing', 'listing', 'listing/p1', 'listing/p1/Amazon', 'listing/p1/TikTok Shop', 'listing/p2', 'settings'];
  for (const r of routes) {
    location.hash = '#' + r;
    vm.runInContext('readHash();render()', ctx);
    const html = el('#app').innerHTML;
    assert(html.length > 200, 'empty view ' + r);
    assert(!html.includes(evil), 'unescaped content in ' + r);
  }
  location.hash = '#studio/p3';
  vm.runInContext('readHash();render()', ctx);
  const st = el('#app').innerHTML;
  assert(st.includes('S: schiena 25 cm') && st.includes('上次识别到的颜色') && st.includes('&lt;b&gt;Blu') && !st.includes('<b>Blu'), 'studio size + detected colours');
  assert(st.includes('上次识别到的尺寸') && st.includes('L · 110 × 80 cm'), 'studio detected sizes');
  location.hash = '#studio/p2';
  vm.runInContext('readHash();render()', ctx);
  assert(el('#app').innerHTML.includes('不会标数字') && el('#app').innerHTML.includes('不勾选时'), 'studio warnings');
  location.hash = '#product/p3';
  vm.runInContext('readHash();render()', ctx);
  const v2 = el('#app').innerHTML;
  assert(v2.includes('主图') && v2.includes('营销图') && v2.includes('备用图') && v2.includes('尺寸 SKU 图') && v2.includes('tile tall'), 'V2 groups and 3:4 tile');
  for (const [plat, want, not] of [['AliExpress', 'D9_x.png', '07_selling'], ['Amazon', 'white_1x1.jpg', '01_front'], ['TikTok Shop', 'scene_3x4.jpg', 'D1_x']]) {
    location.hash = '#listing/p3/' + plat; vm.runInContext('readHash();render()', ctx);
    const side = el('#app').innerHTML.split('本平台图片')[1] || '';
    assert(side.includes(want) && !side.includes(not), 'platform images ' + plat);
  }
  location.hash = '#listing/p3/AliExpress'; vm.runInContext('readHash();render()', ctx);
  assert(el('#app').innerHTML.includes('Materiale: Acrilico'), 'attributes editor');
  location.hash = '#product/p1';
  vm.runInContext("readHash();render();openBox('p1',3)", ctx);
  assert(el('#lightbox').innerHTML.includes('04_x.jpg'), 'lightbox shows the 4th image');
  vm.runInContext('moveBox(-4)', ctx);
  assert(el('#lightbox').innerHTML.includes('D9_x.jpg'), 'lightbox wraps around');
  vm.runInContext('toggleTasks(true)', ctx);
  assert(el('#tasks').innerHTML.includes('九宫格作图') && !el('#tasks').innerHTML.includes(evil), 'task drawer renders escaped');
  // Filters
  vm.runInContext("location.hash='#gallery';readHash();ui.galleryFilter='todo';render()", ctx);
  assert(el('#app').innerHTML.includes('DOG-2') && !el('#app').innerHTML.includes('CAT-1'), 'gallery filter');
  console.log('frontend OK:', routes.length, 'routes');
});
