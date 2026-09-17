const fs=require('fs'),vm=require('vm'),assert=require('assert');
const elements=new Map();const el=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',textContent:'',style:{},attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v},open:false,showModal(){this.open=true},close(){this.open=false},querySelector(){return {disabled:false}},querySelectorAll(){return []}});return elements.get(s)};
const initial={products:[],sales:[],jobs:[],settings:{vat:22,targetMargin:25,shipping:4.5,adRate:5,returnRate:3,fees:{Amazon:15,'TikTok Shop':8,AliExpress:10},style:'test'},capabilities:{codex:true,skill:true,upscaler:true,finalizer:true,modelStatus:'unknown'}};
const ctx={console,document:{querySelector:el,querySelectorAll:()=>[],body:el('body'),activeElement:null},location:{hash:'',origin:'http://127.0.0.1:3310'},window:{addEventListener(){},matchMedia:()=>({matches:false})},URL,Intl,Date,Set,Blob,FormData,setTimeout:()=>0,clearTimeout(){},setInterval(){},fetch:async()=>({ok:true,json:async()=>initial})};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('web/calendar.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('web/app.js','utf8'),ctx);
setImmediate(()=>{
  for(const v of ['research','schedule','studio','uploads','analytics','settings']){vm.runInContext(`go('${v}')`,ctx);assert(el('#app').innerHTML.length>100,v)}
  assert.equal(vm.runInContext(`parseCSV(${JSON.stringify('sku,nameZh\nABC,"猫窝,大号"')})[0].nameZh`,ctx),'猫窝,大号');
  assert.throws(()=>vm.runInContext(`parseCSV(${JSON.stringify('sku,nameZh\nA,"broken')})`,ctx));
  vm.runInContext(`S.products=[{id:'p1',sku:'SKU1',nameZh:'<script>alert(1)</script>',nameIt:'Cuccia',offers:[],cost:10,stock:3,selected:true,scheduledDate:'2026-09-18',uploaded:{},assetsReady:false,assets:[],pricing:Object.fromEntries(sellers.map(x=>[x,{price:30,profit:5,margin:25,market:null}]))}];S.sales=[{id:'s1',sku:'SKU1',date:'2026-09-17',platform:'Amazon',category:'猫窝',units:2,revenue:100,profit:-20,vatAmount:18,refunds:0}];`,ctx);
  for(const v of ['research','schedule','studio','uploads','analytics','settings']){vm.runInContext(`go('${v}')`,ctx);assert(!el('#app').innerHTML.includes('<script>alert'),v)}
  for(const type of ['bar','line','pie']){const html=vm.runInContext(`chartType='${type}';chart(S.sales)`,ctx);assert(html.includes('<svg'));assert(!html.includes('NaN'));assert(!html.includes('Infinity'))}
  vm.runInContext(`detail('p1');editProduct('p1');scheduleDialog();offerDialog('p1');saleDialog();importDialog('products')`,ctx);
  vm.runInContext(`go('research');toggleSidebar()`,ctx);
  assert.equal(el('#sidebar-toggle').attributes['aria-expanded'],'false');
  vm.runInContext(`toggleSidebar()`,ctx);assert.equal(el('#sidebar-toggle').attributes['aria-expanded'],'true');
  assert.equal((el('#nav').innerHTML.match(/class="step-number"/g)||[]).length,5);
  assert(!el('#nav').innerHTML.includes('连接与设置'));
  vm.runInContext(`S.jobs=[{id:'job1',productId:'p1',sku:'SKU1',kind:'images',status:'running',createdAt:'2026-09-17T00:00:00Z',message:'processing',progress:{percent:72,phase:3,label:'已输出 9 / 18 张高清图',outputs:9,elapsedSeconds:150}}];renderChrome();showJob('job1')`,ctx);
  assert(el('#task-list').innerHTML.includes('72%'));assert(el('#dialog').innerHTML.includes('aria-valuenow="72"'));
  assert(el('#dialog').innerHTML.includes('2 分 30 秒'));
  assert(vm.runInContext(`progressMarkup({kind:'research',status:'running',progress:{percent:10,indeterminate:true,label:'searching'}})`,ctx).includes('indeterminate'));
  console.log('Frontend contract checks passed: six views, forms, CSV parsing, escaped content, charts incl negative profit.');
  assert.equal(vm.runInContext(`calendarRange('week','2026-09-20')[0]`,ctx),'2026-09-14');
  assert.equal(vm.runInContext(`calendarRange('week','2026-09-20')[6]`,ctx),'2026-09-20');
  assert.equal(vm.runInContext(`calendarRange('day','2026-09-18').length`,ctx),1);
  assert(vm.runInContext(`calendarRange('month','2024-02-15').includes('2024-02-29')`,ctx));
  assert.equal(vm.runInContext(`calendarRange('month','2026-02-15').length%7`,ctx),0);
  vm.runInContext(`calendarMode='month';calendarFocus='2026-01-31';shiftCalendar(1)`,ctx);
  assert.equal(vm.runInContext('calendarFocus',ctx),'2026-02-28');
  vm.runInContext(`calendarFocus='2026-12-31';shiftCalendar(1)`,ctx);
  assert.equal(vm.runInContext('calendarFocus',ctx),'2027-01-31');
  vm.runInContext(`calendarFocus='2026-09-18';setCalendarMode('day')`,ctx);
  assert(vm.runInContext('calendarView(S.products)',ctx).includes('SKU1'));
  vm.runInContext(`changeCalendarDate('2026-09-19')`,ctx);
  assert(!vm.runInContext('calendarView(S.products)',ctx).includes('SKU1'));
  console.log('Calendar checks passed: day filtering, Monday-start weeks, leap years, month/year boundaries.');
});
