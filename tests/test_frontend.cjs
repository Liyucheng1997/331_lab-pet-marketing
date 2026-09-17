const fs=require('fs'),vm=require('vm'),assert=require('assert');
const elements=new Map();const el=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',textContent:'',style:{},open:false,showModal(){this.open=true},close(){this.open=false},querySelector(){return {disabled:false}},querySelectorAll(){return []}});return elements.get(s)};
const initial={products:[],sales:[],jobs:[],settings:{vat:22,targetMargin:25,shipping:4.5,adRate:5,returnRate:3,fees:{Amazon:15,'TikTok Shop':8,AliExpress:10},style:'test'},capabilities:{codex:true,skill:true,upscaler:true,finalizer:true,modelStatus:'unknown'}};
const ctx={console,document:{querySelector:el,activeElement:null},location:{hash:'',origin:'http://127.0.0.1:3310'},window:{addEventListener(){}},URL,Intl,Date,Set,Blob,FormData,setTimeout:()=>0,clearTimeout(){},setInterval(){},fetch:async()=>({ok:true,json:async()=>initial})};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('web/app.js','utf8'),ctx);
setImmediate(()=>{
  for(const v of ['research','schedule','studio','uploads','analytics','settings']){vm.runInContext(`go('${v}')`,ctx);assert(el('#app').innerHTML.length>100,v)}
  assert.equal(vm.runInContext(`parseCSV(${JSON.stringify('sku,nameZh\nABC,"猫窝,大号"')})[0].nameZh`,ctx),'猫窝,大号');
  assert.throws(()=>vm.runInContext(`parseCSV(${JSON.stringify('sku,nameZh\nA,"broken')})`,ctx));
  vm.runInContext(`S.products=[{id:'p1',sku:'SKU1',nameZh:'<script>alert(1)</script>',nameIt:'Cuccia',offers:[],cost:10,stock:3,selected:true,scheduledDate:'2026-09-18',uploaded:{},assetsReady:false,assets:[],pricing:Object.fromEntries(sellers.map(x=>[x,{price:30,profit:5,margin:25,market:null}]))}];S.sales=[{id:'s1',sku:'SKU1',date:'2026-09-17',platform:'Amazon',category:'猫窝',units:2,revenue:100,profit:-20,vatAmount:18,refunds:0}];`,ctx);
  for(const v of ['research','schedule','studio','uploads','analytics','settings']){vm.runInContext(`go('${v}')`,ctx);assert(!el('#app').innerHTML.includes('<script>alert'),v)}
  for(const type of ['bar','line','pie']){const html=vm.runInContext(`chartType='${type}';chart(S.sales)`,ctx);assert(html.includes('<svg'));assert(!html.includes('NaN'));assert(!html.includes('Infinity'))}
  vm.runInContext(`detail('p1');editProduct('p1');scheduleDialog();offerDialog('p1');saleDialog();importDialog('products')`,ctx);
  console.log('Frontend contract checks passed: six views, forms, CSV parsing, escaped content, charts incl negative profit.');
});
