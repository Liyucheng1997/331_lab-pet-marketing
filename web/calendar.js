// Calendar date arithmetic uses local noon to avoid UTC/DST date shifts.
function calendarKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function calendarDate(key){return new Date(key+'T12:00:00')}
let calendarMode=(()=>{try{const mode=localStorage.getItem('petops.calendarMode');return ['day','week','month'].includes(mode)?mode:'week'}catch{return 'week'}})();
let calendarFocus=calendarKey(new Date());
function calendarRange(mode,focus){
 const anchor=calendarDate(focus),start=new Date(anchor);let count=1;
 if(mode==='week'){start.setDate(start.getDate()-(start.getDay()+6)%7);count=7}
 if(mode==='month'){
  start.setDate(1);const offset=(start.getDay()+6)%7;
  count=Math.ceil((offset+new Date(anchor.getFullYear(),anchor.getMonth()+1,0,12).getDate())/7)*7;
  start.setDate(start.getDate()-offset);
 }
 return Array.from({length:count},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return calendarKey(d)});
}
function setCalendarMode(mode){if(!['day','week','month'].includes(mode))return;calendarMode=mode;try{localStorage.setItem('petops.calendarMode',mode)}catch{}render()}
function changeCalendarDate(key){if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||calendarKey(calendarDate(key))!==key)return;calendarFocus=key;render()}
function calendarToday(){calendarFocus=calendarKey(new Date());render()}
function shiftCalendar(direction){
 const d=calendarDate(calendarFocus);
 if(calendarMode==='month'){const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+direction);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0,12).getDate()))}
 else d.setDate(d.getDate()+direction*(calendarMode==='week'?7:1));
 calendarFocus=calendarKey(d);render();
}
function openCalendarDay(key){calendarFocus=key;setCalendarMode('day')}
function calendarTask(p){return `<article class="calendar-task"><button class="calendar-task-open" onclick="openStudio('${p.id}')"><strong>${esc(p.nameZh||p.nameIt||p.sku)}</strong><span class="calendar-sku">${esc(p.sku)}</span>${tag(p.assetsReady?'素材完成':'待制作',p.assetsReady?'green':'')}</button><button class="calendar-remove" title="取消此商品排期" aria-label="取消 ${esc(p.sku)} 的排期" onclick="act('unschedule',{id:'${p.id}'},'已取消排期')">×</button></article>`}
function calendarView(products){
 const dates=calendarRange(calendarMode,calendarFocus),groups=Object.create(null),now=calendarKey(new Date()),focus=calendarDate(calendarFocus);
 products.filter(p=>p.scheduledDate).forEach(p=>(groups[p.scheduledDate]??=[]).push(p));
 const count=dates.reduce((n,d)=>n+(groups[d]?.length||0),0);
 const weekdays=['周一','周二','周三','周四','周五','周六','周日'];
 const title=calendarMode==='month'?`${focus.getFullYear()} 年 ${focus.getMonth()+1} 月`:calendarMode==='week'?`${dates[0]} — ${dates[6]}`:`${calendarFocus} · ${weekdays[(focus.getDay()+6)%7]}`;
 const unit={day:'天',week:'周',month:'月'}[calendarMode];
 const periodCount=calendarMode==='month'?products.filter(p=>p.scheduledDate?.slice(0,7)===calendarFocus.slice(0,7)).length:count;
 return `<section class="schedule-calendar" aria-label="制作日历"><div class="calendar-toolbar"><div><h2>制作日历</h2><p class="calendar-period" aria-live="polite">${title} <span class="tag">${periodCount} 件${calendarMode==='month'?' / 本月':''}</span></p></div><div class="calendar-controls"><div class="calendar-modes" role="group" aria-label="日历视角">${[['day','日'],['week','周'],['month','月']].map(([mode,label])=>`<button aria-pressed="${calendarMode===mode}" class="${calendarMode===mode?'active':''}" onclick="setCalendarMode('${mode}')">${label}</button>`).join('')}</div><div class="calendar-pager"><button aria-label="上一${unit}" onclick="shiftCalendar(-1)">‹</button><button onclick="calendarToday()">今天</button><button aria-label="下一${unit}" onclick="shiftCalendar(1)">›</button></div><input class="calendar-jump" type="date" aria-label="跳转到日期" value="${calendarFocus}" onchange="changeCalendarDate(this.value)"></div></div><div class="calendar-scroll"><div class="calendar-board calendar-${calendarMode}">${calendarMode!=='day'?weekdays.map(w=>`<div class="calendar-weekday">${w}</div>`).join(''):''}${dates.map(date=>{
 const ps=groups[date]||[],outside=calendarMode==='month'&&date.slice(0,7)!==calendarFocus.slice(0,7),shown=calendarMode==='month'?ps.slice(0,3):ps;
 return `<section class="calendar-cell ${outside?'outside-month':''} ${date===now?'is-today':''}" aria-label="${date}，${ps.length} 件"><div class="calendar-cell-head"><button class="calendar-date" ${date===now?'aria-current="date"':''} onclick="openCalendarDay('${date}')">${calendarMode==='month'?Number(date.slice(-2)):date.slice(5)}${date===now?' <span>今天</span>':''}</button><span>${ps.length} 件</span></div><div class="calendar-day-tasks">${shown.length?shown.map(calendarTask).join(''):`<p class="calendar-no-tasks">${calendarMode==='day'?'当天没有安排商品，可点击上方“自动排期”安排。':'暂无安排'}</p>`}${ps.length>shown.length?`<button class="calendar-more" onclick="openCalendarDay('${date}')">查看全部 ${ps.length} 件 →</button>`:''}</div></section>`
 }).join('')}</div></div><p class="calendar-caption">${calendarMode==='month'?'点击日期或“查看全部”进入当天视角。':'点击商品进入创作工坊。'} 排期按天安排，尚未设置具体时段。</p></section>`;
}
