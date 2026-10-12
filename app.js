/* ============================================================
   Project Time —— 前端逻辑
   ============================================================ */

/* ---------- 常量 ---------- */
const PALETTE = ['#0F766E','#4F46E5','#B45309','#BE123C','#0369A1','#047857','#7C3AED','#C2410C','#0E7490','#DB2777','#65A30D','#475569'];
const WD = ['周日','周一','周二','周三','周四','周五','周六'];
const HOUR_PX = 60;                 // 时间轴每小时像素
const AXIS_W = 24 * HOUR_PX;        // 1440px = 一天 24 小时

/* ---------- 状态 ---------- */
let db = { events: [] };
let view = 'home';                  // home | calendar | timeline
let dayDate = null;                 // 非 null = 处于「日视图」（ISO 字符串）
let monthCursor = new Date();
let weekCursor = startOfWeek(new Date());
let editingId = null;
let pickedColor = PALETTE[0];
let chatHistory = [];
let previewCache = {};              // date -> text
let backendOk = false;              // 本地服务器（AI）是否可用

/* ---------- 日期工具 ---------- */
function pad(n){ return String(n).padStart(2,'0'); }
function fmt(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function parse(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(y,m-1,d); }
function startOfWeek(d){ const x=new Date(d); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function addMonths(d,n){ return new Date(d.getFullYear(), d.getMonth()+n, 1); }
function toMin(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function minToHHMM(min){ return pad(Math.floor(min/60))+':'+pad(Math.round(min%60)); }
function round30(d){ const m=d.getMinutes(); d.setMinutes(m<30?0:30,0,0); return d; }
function durLabel(min){ if(min<60) return min+'分钟'; if(min%60===0) return (min/60)+'小时'; return (min/60).toFixed(1)+'小时'; }
function uid(){ return 'e'+Date.now()+Math.random().toString(36).slice(2,7); }
function pickColor(){ return PALETTE[Math.floor(Math.random()*PALETTE.length)]; }
function eventsOn(iso){ return (db.events||[]).filter(e=>e.date===iso).sort((a,b)=>toMin(a.start)-toMin(b.start)); }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- 数据持久化 ---------- */
async function loadData(){
  let fromServer = false;
  try {
    const r = await fetch('/api/data');
    if (r.ok){ db = await r.json(); fromServer = true; }
  } catch(e){}
  if (!fromServer){
    try { db = JSON.parse(localStorage.getItem('project-time-db')) || {events:[]}; } catch(e){ db={events:[]}; }
  }
  backendOk = fromServer;
  if (!db.events) db.events = [];
  if (!db.seeded && db.events.length===0){ seed(); db.seeded=true; await saveData(); }
}
async function saveData(){
  previewCache = {};                              // 数据变了，下次重生成预览
  localStorage.setItem('project-time-db', JSON.stringify(db));
  try { await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(db)}); } catch(e){}
}

function seed(){
  const today = new Date();
  const at=(off,h,m)=>fmt(addDays(today,off))+':'+minToHHMM(h*60+m);
  const ev=(name,off,h,m,dur,color,desc)=>{ const t=at(off,h,m); db.events.push({id:uid(),name,date:t.slice(0,10),start:t.slice(11),duration:dur,color,description:desc||''}); };
  ev('产品周会',0,10,0,60,'#4F46E5','评审本周迭代');
  ev('首页视觉设计',0,14,0,120,'#0F766E','');
  ev('健身',0,19,0,60,'#047857','');
  ev('需求评审',1,9,30,90,'#4F46E5','');
  ev('后台接口开发',1,13,0,180,'#0369A1','');
  ev('写周报',2,17,0,30,'#B45309','');
  ev('项目复盘',3,15,0,60,'#BE123C','');
  ev('发布窗口',4,20,0,60,'#C2410C','');
}

/* ---------- AI 调用 ---------- */
async function ai(payload){
  const r = await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ('AI 请求失败 ('+r.status+')'));
  return j;
}

/* ============================================================
   渲染
   ============================================================ */
function render(){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on', b.dataset.view===view));
  const v = document.getElementById('view');
  if (dayDate){ renderDay(v, parse(dayDate), true); return; }
  if (view==='home') renderDay(v, new Date(), false);
  else if (view==='calendar') renderCalendar(v);
  else renderTimeline(v);
}

/* ---------- 首页 / 日视图 ---------- */
function renderDay(v, date, showBack){
  const iso = fmt(date);
  const isToday = iso === fmt(new Date());
  const list = eventsOn(iso);
  let html = '<div class="home">';
  if (showBack) html += `<div class="back-row"><button class="back-btn" id="backBtn">← 返回</button></div>`;
  html += `<div class="home-head"><div>`;
  html += `<div class="date">${date.getMonth()+1}月${date.getDate()}日 ${WD[date.getDay()]}</div>`;
  html += `<div class="sub">${isToday?'今天':date.getFullYear()+'年'} · ${list.length} 项安排</div>`;
  html += `</div><button class="add-btn" id="addBtn" title="添加日程">＋</button></div>`;

  if (isToday){
    html += `<div class="ai-card"><div class="ai-head"><span class="t">✨ 今日预览</span><button class="regen" id="regenBtn">重新生成</button></div>`;
    html += `<div class="ai-body" id="aiPreviewBody"></div></div>`;
  }

  html += `<div class="schedule-title">日程安排</div><div class="schedule-list">`;
  if (!list.length) html += `<div class="empty"><div class="big">📭</div>这一天还没有安排，点右上角 ＋ 添加，或让 AI 帮你生成。</div>`;
  list.forEach(e=>{
    html += `<div class="evt-row" data-id="${e.id}"><span class="bar" style="background:${e.color}"></span>`;
    html += `<span class="time tnum">${e.start}</span>`;
    html += `<div class="body"><div class="name">${esc(e.name)}</div><div class="meta">${durLabel(e.duration)}${e.description?' · '+esc(e.description):''}</div></div>`;
    html += `<button class="del" data-del="${e.id}" title="删除">✕</button></div>`;
  });
  html += `</div></div>`;
  v.innerHTML = html;

  if (isToday) renderPreview(iso);
}

async function renderPreview(iso){
  const el = document.getElementById('aiPreviewBody'); if(!el) return;
  if (!backendOk){ el.className='ai-body'; el.textContent='（静态版）AI 今日预览需本地运行 node server.js'; return; }
  if (previewCache[iso]){ el.textContent = previewCache[iso]; el.className='ai-body'; return; }
  const list = eventsOn(iso);
  if (!list.length){ const t='今天还没有安排日程。点右上角「＋」手动添加，或在顶部「✚」用 AI 自动导入。'; previewCache[iso]=t; el.textContent=t; return; }
  el.className = 'ai-body loading'; el.textContent = '正在生成今日预览…';
  try {
    const desc = list.map(e=>`${e.start} ${e.name}（${durLabel(e.duration)}${e.description?('，'+e.description):''}）`).join('\n');
    const j = await ai({messages:[
      {role:'system',content:'你是用户的日程助手。根据用户今天的日程，用中文生成一段简短、友好、有条理的今日预览（150字以内），按时间顺序概述，语气自然亲切。只输出预览正文，不要加标题或序号。'},
      {role:'user',content:`今天是 ${iso}（${WD[parse(iso).getDay()]}）。我的今日日程：\n${desc}`}
    ],temperature:0.7});
    const text = (j.choices[0].message.content||'').trim();
    previewCache[iso] = text;
    if (document.getElementById('aiPreviewBody')===el){ el.className='ai-body'; el.textContent = text; }
  } catch(e){
    el.className = 'ai-body err'; el.textContent = '预览生成失败：'+e.message;
  }
}

/* ---------- 日历 ---------- */
function renderCalendar(v){
  const y=monthCursor.getFullYear(), m=monthCursor.getMonth();
  const first = new Date(y,m,1);
  const gridStart = startOfWeek(first);
  const todayIso = fmt(new Date());
  let html = '<div class="calendar">';
  html += `<div class="cal-head"><span class="ttl">${y}年${m+1}月</span><div class="nav">`;
  html += `<button class="navbtn" id="calPrev">‹</button><button class="today-btn" id="calToday">今天</button><button class="navbtn" id="calNext">›</button></div></div>`;
  html += `<div class="cal-weekdays">${['一','二','三','四','五','六','日'].map(w=>`<div>周${w}</div>`).join('')}</div>`;
  html += `<div class="cal-grid">`;
  for(let i=0;i<42;i++){
    const d=addDays(gridStart,i), iso=fmt(d);
    const out = d.getMonth()!==m;
    const isToday = iso===todayIso;
    const list = eventsOn(iso);
    const cls=['cal-cell',out?'out':'',(d.getDay()===0||d.getDay()===6)?'wk':'',isToday?'today':''].filter(Boolean).join(' ');
    const dots = list.slice(0,5).map(e=>`<span class="dot" style="background:${e.color}"></span>`).join('');
    html += `<div class="${cls}" data-date="${iso}"><div class="num tnum">${d.getDate()}</div>`;
    html += `<div class="dots">${dots}</div>`;
    if (list.length>5) html += `<div class="count">+${list.length-5}</div>`;
    html += `</div>`;
  }
  html += `</div></div>`;
  v.innerHTML = html;
}

/* ---------- 时间轴 ---------- */
function renderTimeline(v){
  const todayIso = fmt(new Date());
  const days=[]; for(let i=0;i<7;i++) days.push(addDays(weekCursor,i));
  let html = '<div class="timeline">';
  html += `<div class="tl-head"><span class="ttl">本周</span>`;
  html += `<div class="nav"><button class="navbtn" id="wkPrev">‹</button><button class="today-btn" id="wkToday">回到本周</button><button class="navbtn" id="wkNext">›</button></div></div>`;
  html += `<div class="tl-hint">点击时间条进入当天视图 · 点击空白处按该时间新建</div>`;
  html += `<div class="tl-scroll" id="tlScroll">`;
  days.forEach(d=>{
    const iso=fmt(d), isToday=iso===todayIso;
    html += `<div class="tl-row"><div class="tl-day ${isToday?'today':''}"><span class="wd">${WD[d.getDay()]}</span><span class="dt tnum">${d.getMonth()+1}/${d.getDate()}</span></div>`;
    html += `<div class="tl-axis" data-date="${iso}">`;
    for(let h=0;h<=24;h++){
      const major = h%3===0;
      html += `<div class="gridline ${major?'major':''}" style="left:${h*HOUR_PX}px"></div>`;
      if (major && h<24) html += `<div class="glabel tnum" style="left:${h*HOUR_PX}px">${pad(h)}:00</div>`;
    }
    eventsOn(iso).forEach(e=>{
      const left = toMin(e.start)/60*HOUR_PX;
      const width = Math.max(e.duration/60*HOUR_PX, 6);
      html += `<div class="tl-event" data-date="${iso}" style="left:${left}px;width:${width}px;background:${e.color}" title="${esc(e.name)} ${e.start}（${durLabel(e.duration)}）"><span class="nm">${esc(e.name)}</span></div>`;
    });
    html += `</div></div>`;
  });
  html += `</div></div>`;
  v.innerHTML = html;
}

/* ============================================================
   增删改
   ============================================================ */
function openAdd(id, date, startTime){
  editingId = id || null;
  document.getElementById('addTitle').textContent = id ? '编辑日程' : '添加日程';
  document.getElementById('delBtn').style.display = id ? '' : 'none';
  document.getElementById('saveBtn').textContent = id ? '保存' : '添加';

  const now = round30(new Date());
  if (id){
    const e = db.events.find(x=>x.id===id);
    document.getElementById('fName').value = e.name;
    document.getElementById('fDate').value = e.date;
    document.getElementById('fStart').value = e.start;
    document.getElementById('fDuration').value = String(e.duration);
    pickedColor = e.color;
    document.getElementById('fDesc').value = e.description||'';
  } else {
    document.getElementById('fName').value = '';
    document.getElementById('fDate').value = date || fmt(new Date());
    document.getElementById('fStart').value = startTime || minToHHMM(now.getHours()*60+now.getMinutes());
    document.getElementById('fDuration').value = '60';
    pickedColor = pickColor();
    document.getElementById('fDesc').value = '';
  }
  renderSwatches();
  document.getElementById('addOverlay').classList.add('show');
  document.getElementById('fName').focus();
}
function renderSwatches(){
  const row = document.getElementById('colorRow');
  row.innerHTML = PALETTE.map(c=>`<span class="swatch ${c===pickedColor?'sel':''}" data-color="${c}" style="background:${c}"></span>`).join('');
}

/* ============================================================
   AI 自动导入（文字）
   ============================================================ */
const ADD_EVENTS_TOOL = { type:'function', function:{ name:'add_events', description:'添加一条或多条日程事件', parameters:{ type:'object', properties:{ events:{ type:'array', description:'识别到的日程列表', items:{ type:'object', properties:{
  name:{type:'string',description:'事件名称'},
  date:{type:'string',description:'日期 YYYY-MM-DD'},
  start:{type:'string',description:'开始时间 HH:MM 24小时制'},
  duration:{type:'integer',description:'时长（分钟），默认60'},
  description:{type:'string',description:'描述，可空'}
}, required:['name','date','start'] } } }, required:['events'] } } };

async function importText(text){
  const today = fmt(new Date());
  const j = await ai({messages:[
    {role:'system',content:`你是日程解析助手。从用户文字中提取所有日程事件。今天是 ${today}（${WD[new Date().getDay()]}）。把相对时间（明天、后天、下周一、下午3点、周五、今晚等）换算成具体日期 YYYY-MM-DD 和开始时间 HH:MM（24小时制）。时长换算成分钟；没写时长默认 60 分钟。用 add_events 工具一次性提交所有事件。`},
    {role:'user',content:text}
  ], tools:[ADD_EVENTS_TOOL], temperature:0.1});
  const msg = j.choices[0].message;
  let added = 0;
  if (msg.tool_calls && msg.tool_calls.length){
    for (const tc of msg.tool_calls){
      if (tc.function.name!=='add_events') continue;
      let args={}; try{ args=JSON.parse(tc.function.arguments||'{}'); }catch(e){}
      for (const ev of (args.events||[])){
        db.events.push({ id:uid(), name:ev.name||'未命名', date:ev.date||today, start:ev.start||'09:00', duration:ev.duration||60, color:pickColor(), description:ev.description||'' });
        added++;
      }
    }
  }
  return added;
}

/* ============================================================
   AI 对话
   ============================================================ */
const CHAT_TOOLS = [
  { type:'function', function:{ name:'list_events', description:'查看某天的日程', parameters:{ type:'object', properties:{ date:{type:'string',description:'日期 YYYY-MM-DD，可选，默认今天'} } } } },
  { type:'function', function:{ name:'add_event', description:'添加一条日程', parameters:{ type:'object', properties:{ name:{type:'string',description:'事件名称'}, date:{type:'string',description:'YYYY-MM-DD'}, start:{type:'string',description:'HH:MM'}, duration:{type:'integer',description:'分钟'}, description:{type:'string'} }, required:['name','date','start'] } } },
  { type:'function', function:{ name:'remove_event', description:'删除日程（按日期+名称匹配）', parameters:{ type:'object', properties:{ date:{type:'string',description:'YYYY-MM-DD'}, name:{type:'string',description:'要删除的事件名称（支持部分匹配）'} }, required:['date','name'] } } },
];
function initChatSystem(){
  chatHistory = [{role:'system',content:`你是用户的日程助手，帮他管理日程。今天是 ${fmt(new Date())}（${WD[new Date().getDay()]}）。回答用中文、简洁。需要查看/添加/删除日程时调用相应工具；操作完成后用一句话告知结果。`}];
}
async function runTool(name, args){
  const today = fmt(new Date());
  if (name==='list_events'){
    const d = args.date || today;
    const list = eventsOn(d);
    if (!list.length) return { result:`${d} 没有日程` };
    return { result: list.map(e=>`${e.start} ${e.name}（${durLabel(e.duration)}）${e.description?' - '+e.description:''}`).join('\n') };
  }
  if (name==='add_event'){
    const ev = { id:uid(), name:args.name, date:args.date||today, start:args.start||'09:00', duration:args.duration||60, color:pickColor(), description:args.description||'' };
    db.events.push(ev);
    return { ok:true, added:`${ev.date} ${ev.start} ${ev.name}` };
  }
  if (name==='remove_event'){
    const before = db.events.length;
    db.events = db.events.filter(e=>!(e.date===(args.date||today) && e.name.includes(args.name||'')));
    return { ok:true, removed: before - db.events.length };
  }
  return { error:'未知工具 '+name };
}
async function sendChat(){
  const input = document.getElementById('chatText');
  const text = input.value.trim(); if(!text) return;
  if(!backendOk){ appendMsg('ai','（静态版）AI 对话需本地运行 node server.js'); return; }
  appendMsg('user', text);
  chatHistory.push({role:'user',content:text});
  input.value='';
  const thinking = appendMsg('ai', '…');
  const actions = [];
  try {
    const messages = [...chatHistory];
    for (let i=0;i<6;i++){
      const j = await ai({messages, tools:CHAT_TOOLS, temperature:0.4});
      const msg = j.choices[0].message;
      messages.push(msg);
      if (msg.tool_calls && msg.tool_calls.length){
        const results=[];
        for (const tc of msg.tool_calls){
          let args={}; try{ args=JSON.parse(tc.function.arguments||'{}'); }catch(e){}
          const r = await runTool(tc.function.name, args);
          if (tc.function.name==='add_event' && r.added) actions.push('＋ '+r.added);
          if (tc.function.name==='remove_event' && r.removed) actions.push('－ 已删除 '+r.removed+' 项');
          results.push({role:'tool', tool_call_id:tc.id, content:JSON.stringify(r)});
        }
        messages.push(...results);
      } else {
        chatHistory = messages;
        let content = (msg.content||'').trim();
        if (actions.length) content += '\n\n'+actions.map(a=>'· '+a).join('\n');
        thinking.textContent = content || '(无回复)';
        thinking.classList.add('ai');
        await saveData(); render();
        return;
      }
    }
    thinking.textContent = '(处理步骤过多，已停止)';
  } catch(e){
    thinking.textContent = '出错：'+e.message;
    thinking.style.color = 'var(--danger)';
  }
}
function appendMsg(role, text){
  const body = document.getElementById('chatBody');
  const d = document.createElement('div');
  d.className = 'msg '+(role==='user'?'user':'ai');
  d.textContent = text;
  body.appendChild(d);
  body.scrollTop = body.scrollHeight;
  return d;
}

/* ============================================================
   事件绑定
   ============================================================ */
function toast(msg){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),1800);
}

// 顶部标签
document.getElementById('tabs').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  view=b.dataset.view; dayDate=null; render();
});

// 视图内事件委托
document.getElementById('view').addEventListener('click', async e=>{
  // 返回
  if (e.target.closest('#backBtn')){ dayDate=null; render(); return; }
  // 添加
  if (e.target.closest('#addBtn')){ openAdd(null, dayDate || undefined, undefined); return; }
  // 重新生成预览
  if (e.target.closest('#regenBtn')){ delete previewCache[fmt(new Date())]; render(); return; }
  // 删除
  const del=e.target.closest('[data-del]');
  if (del){ db.events=db.events.filter(x=>x.id!==del.dataset.del); await saveData(); render(); toast('已删除'); return; }
  // 编辑（点行）
  const row=e.target.closest('.evt-row[data-id]');
  if (row){ openAdd(row.dataset.id); return; }
  // 日历：点日期进日视图
  const cell=e.target.closest('.cal-cell[data-date]');
  if (cell){ dayDate=cell.dataset.date; render(); return; }
  // 时间轴：点时间条进日视图；点空白处新建
  const bar=e.target.closest('.tl-event[data-date]');
  if (bar){ dayDate=bar.dataset.date; render(); return; }
  const axis=e.target.closest('.tl-axis[data-date]');
  if (axis && !bar){
    const rect=axis.getBoundingClientRect();
    const x=e.clientX-rect.left;
    const minutes=Math.floor(x/HOUR_PX*60/30)*30;
    openAdd(null, axis.dataset.date, minToHHMM(minutes));
    return;
  }
});

// 日历导航
document.getElementById('view').addEventListener('click', e=>{
  if (e.target.closest('#calPrev')){ monthCursor=addMonths(monthCursor,-1); render(); }
  else if (e.target.closest('#calNext')){ monthCursor=addMonths(monthCursor,1); render(); }
  else if (e.target.closest('#calToday')){ monthCursor=new Date(); render(); }
  else if (e.target.closest('#wkPrev')){ weekCursor=addDays(weekCursor,-7); render(); }
  else if (e.target.closest('#wkNext')){ weekCursor=addDays(weekCursor,7); render(); }
  else if (e.target.closest('#wkToday')){ weekCursor=startOfWeek(new Date()); render(); }
});

// 添加弹窗
document.getElementById('cancelBtn').onclick=()=>document.getElementById('addOverlay').classList.remove('show');
document.getElementById('colorRow').addEventListener('click',e=>{
  const s=e.target.closest('.swatch'); if(!s) return;
  pickedColor=s.dataset.color; renderSwatches();
});
document.getElementById('saveBtn').onclick=async ()=>{
  const name=document.getElementById('fName').value.trim();
  if(!name){ toast('请填写事件名称'); return; }
  const data={
    name,
    date: document.getElementById('fDate').value,
    start: document.getElementById('fStart').value || '09:00',
    duration: parseInt(document.getElementById('fDuration').value,10)||60,
    color: pickedColor,
    description: document.getElementById('fDesc').value.trim(),
  };
  if (editingId){
    Object.assign(db.events.find(x=>x.id===editingId), data);
    toast('已保存');
  } else {
    db.events.push({id:uid(), ...data});
    toast('已添加');
  }
  await saveData();
  document.getElementById('addOverlay').classList.remove('show');
  render();
};
document.getElementById('delBtn').onclick=async ()=>{
  if(!editingId) return;
  db.events=db.events.filter(x=>x.id!==editingId);
  await saveData();
  document.getElementById('addOverlay').classList.remove('show');
  render(); toast('已删除');
};

// AI 导入弹窗
document.getElementById('importBtn').onclick=()=>document.getElementById('importOverlay').classList.add('show');
document.getElementById('importCancel').onclick=()=>document.getElementById('importOverlay').classList.remove('show');
document.getElementById('importGo').onclick=async ()=>{
  const text=document.getElementById('fImportText').value.trim();
  if(!text){ toast('请输入文字'); return; }
  if(!backendOk){ toast('AI 导入需本地运行 node server.js'); return; }
  const btn=document.getElementById('importGo'); btn.disabled=true; btn.textContent='识别中…';
  try {
    const n=await importText(text);
    document.getElementById('importOverlay').classList.remove('show');
    document.getElementById('fImportText').value='';
    await saveData(); render();
    toast(n?`已导入 ${n} 项日程`:'没有识别到日程');
  } catch(e){
    toast('导入失败：'+e.message);
  } finally { btn.disabled=false; btn.textContent='导入'; }
};

// AI 对话面板
document.getElementById('chatBtn').onclick=()=>document.getElementById('chatPanel').classList.add('open');
document.getElementById('chatClose').onclick=()=>document.getElementById('chatPanel').classList.remove('open');
document.getElementById('chatSend').onclick=sendChat;
document.getElementById('chatText').addEventListener('keydown',e=>{
  if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); }
});

// 主题
document.getElementById('themeBtn').onclick=()=>{
  const t=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=t;
  document.getElementById('themeBtn').textContent=t==='dark'?'☀':'◐';
};

document.addEventListener('keydown',e=>{
  if (e.key==='Escape'){
    document.getElementById('addOverlay').classList.remove('show');
    document.getElementById('importOverlay').classList.remove('show');
  }
});

/* ---------- 启动 ---------- */
(async function init(){
  await loadData();
  initChatSystem();
  render();
})();
