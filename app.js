/* ============================================================
   Project Time —— 前端逻辑
   ============================================================ */

/* ---------- 常量 ---------- */
const PALETTE = ['#0F766E','#4F46E5','#B45309','#BE123C','#0369A1','#047857','#7C3AED','#C2410C','#0E7490','#DB2777','#65A30D','#475569'];
const WD = ['周日','周一','周二','周三','周四','周五','周六'];
const HOUR_PX = 60;                 // 时间轴每小时像素
const AXIS_W = 24 * HOUR_PX;        // 1440px = 一天 24 小时

const IMPORTANCE = {
  normal:   { label: '一般',     color: '#16A34A' },
  important: { label: '重要',     color: '#2563EB' },
  urgent:   { label: '紧急',     color: '#EA580C' },
  critical: { label: '非常紧急', color: '#DC2626' },
};
const STATUS = { todo: '未完成', doing: '进行中', done: '已完成' };

/* ---------- 状态 ---------- */
let db = { events: [], todos: [], goals: [] };
let view = 'home';                  // home | calendar | timeline | goals
let dayDate = null;                 // 非 null = 处于「日视图」（ISO 字符串）
let monthCursor = new Date();
let weekCursor = startOfWeek(new Date());
let editingId = null;               // 编辑中的「日程」id
let editingTaskId = null;           // 编辑中的「待办/目标」id
let taskType = 'todo';              // 添加弹窗当前类型 todo | goal
let taskMode = 'week';              // 目标/待办界面 周/月
let detailTodoId = null;            // 待办详情弹窗当前 id
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

/* ---------- 待办 / 目标 工具 ---------- */
function todayIso(){ return fmt(new Date()); }
function daysUntil(iso){ return Math.round((parse(iso)-parse(todayIso()))/86400000); }
function liveTodos(){
  const t = todayIso();
  return (db.todos||[]).filter(x=>!(x.status==='done' && x.doneAt && x.doneAt < t));
}
function effectiveImportance(t){
  // ddl 当天且重要程度≥重要 → 自动升级为「非常紧急」
  if (t.status!=='done' && t.ddl===todayIso() && (t.importance==='important'||t.importance==='urgent'||t.importance==='critical')) return 'critical';
  return t.importance;
}
function periodKey(period){
  const d = new Date();
  if (period==='week') return fmt(startOfWeek(d));
  return d.getFullYear()+'-'+pad(d.getMonth()+1);
}
function goalCount(g){ return (g.completions && g.completions[periodKey(g.period)]) || 0; }
function goalStatus(g){
  const c = goalCount(g);
  if (c<=0) return '未完成';
  if (c < g.freq) return '进行中';
  return '已完成';
}
function periodRange(mode){
  const d = new Date();
  if (mode==='month'){
    return { start: fmt(new Date(d.getFullYear(), d.getMonth(), 1)), end: fmt(new Date(d.getFullYear(), d.getMonth()+1, 0)) };
  }
  const s = startOfWeek(d);
  return { start: fmt(s), end: fmt(addDays(s,6)) };
}
function homeReminders(){
  return liveTodos()
    .filter(t=>t.status!=='done')
    .filter(t=>t.importance==='critical' || daysUntil(t.ddl)<=3)
    .sort((a,b)=>a.ddl.localeCompare(b.ddl));
}
function goalsSorted(){
  const arr = (db.goals||[]).slice();
  arr.sort((a,b)=>{
    const da = goalCount(a)>=a.freq ? 1 : 0;
    const dbg = goalCount(b)>=b.freq ? 1 : 0;
    return da-dbg || (a.createdAt||0)-(b.createdAt||0);
  });
  return arr;
}

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
  if (!db.todos) db.todos = [];
  if (!db.goals) db.goals = [];
  purgeDone();
  if (!db.seeded && db.events.length===0){ seed(); db.seeded=true; await saveData(); }
}
async function saveData(){
  previewCache = {};                              // 数据变了，下次重生成预览
  purgeDone();
  localStorage.setItem('project-time-db', JSON.stringify(db));
  try { await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(db)}); } catch(e){}
}
function purgeDone(){
  const t = todayIso();
  db.todos = (db.todos||[]).filter(x=>!(x.status==='done' && x.doneAt && x.doneAt < t));
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
  const td=(name,off,importance,status,desc)=>{ db.todos.push({id:uid(),name,ddl:fmt(addDays(today,off)),description:desc||'',importance,status,doneAt:status==='done'?todayIso():null,createdAt:Date.now()}); };
  td('提交项目周报',1,'important','todo','汇总本周进度');
  td('回复客户邮件',0,'normal','doing','');
  td('预约牙医',3,'urgent','todo','');
  const gl=(name,period,freq,desc)=>{ db.goals.push({id:uid(),name,description:desc||'',period,freq,completions:{},createdAt:Date.now()}); };
  gl('每周健身','week',3,'');
  gl('每月读书','month',2,'本月读《原则》');
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
  else if (view==='timeline') renderTimeline(v);
  else if (view==='goals') renderGoals(v);
}

/* ---------- 首页 / 日视图 ---------- */
function renderDay(v, date, showBack){
  const iso = fmt(date);
  const isToday = iso === todayIso();
  const list = eventsOn(iso);
  let html = '<div class="home">';
  if (showBack) html += `<div class="back-row"><button class="back-btn" id="backBtn">← 返回</button></div>`;
  html += `<div class="home-head"><div>`;
  html += `<div class="date">${date.getMonth()+1}月${date.getDate()}日 ${WD[date.getDay()]}</div>`;
  html += `<div class="sub">${isToday?'今天':date.getFullYear()+'年'} · ${list.length} 项安排</div>`;
  html += `</div><button class="add-btn" id="addBtn" title="添加日程">＋</button></div>`;

  if (isToday){
    html += `<div class="ai-card"><div class="ai-head"><span class="t">🐱 今日纪要</span><button class="regen" id="regenBtn">重新生成</button></div>`;
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
  html += `</div>`;

  if (isToday){
    // 待办提醒（ddl 临近 / 非常紧急）
    const rem = homeReminders();
    if (rem.length){
      html += `<div class="schedule-title">待办提醒</div><div class="reminder-list">`;
      rem.forEach(t=>{
        const imp = effectiveImportance(t);
        const c = IMPORTANCE[imp].color;
        html += `<div class="todo-row" data-todo="${t.id}"><span class="bar" style="background:${c}"></span>`;
        html += `<div class="body"><div class="name">${esc(t.name)}</div><div class="meta tnum">${t.ddl} · ${IMPORTANCE[imp].label}</div></div>`;
        html += `<span class="chev">›</span></div>`;
      });
      html += `</div>`;
    }
    // 目标（最下方）
    const goals = goalsSorted();
    if (goals.length){
      html += `<div class="schedule-title">目标</div><div class="goal-list">`;
      goals.forEach(g=>{
        const c = goalCount(g), done = c>=g.freq;
        html += `<div class="goal-row" data-goal="${g.id}"><div class="body">`;
        html += `<div class="name">${done?'<span class="done-check">✓</span> ':''}${esc(g.name)}</div>`;
        html += `<div class="meta">${g.period==='week'?'每周':'每月'} ${g.freq} 次 · 已完成 ${Math.min(c,g.freq)}/${g.freq}</div></div>`;
        html += `<span class="goal-status ${done?'done':''}">${goalStatus(g)}</span></div>`;
      });
      html += `</div>`;
    }
  }
  html += `</div>`;
  v.innerHTML = html;

  if (isToday) renderPreview(iso);
}

/* ---------- AI 今日纪要（猫娘） ---------- */
async function renderPreview(iso){
  const el = document.getElementById('aiPreviewBody'); if(!el) return;
  if (!backendOk){ el.className='ai-body'; el.textContent='（静态版）AI 今日纪要需本地运行 node server.js'; return; }
  if (previewCache[iso]){ el.className='ai-body'; el.innerHTML = mdBold(previewCache[iso]); return; }
  const list = eventsOn(iso);
  const rem = homeReminders();
  const goals = (db.goals||[]);
  if (!list.length && !rem.length && !goals.length){
    const t='喵～主人今天还没有安排和待办呢，先点右上角「＋」添加，或让小猫帮你 AI 导入吧～'; previewCache[iso]=t; el.innerHTML = mdBold(t); return;
  }
  el.className = 'ai-body loading'; el.textContent = '小猫正在给主人写纪要…';
  try {
    const parts = [];
    if (list.length) parts.push('【日程】\n'+list.map(e=>`${e.start} ${e.name}（${durLabel(e.duration)}${e.description?('，'+e.description):''}）`).join('\n'));
    if (rem.length) parts.push('【待办提醒】\n'+rem.map(t=>`${t.name}（ddl ${t.ddl}，${IMPORTANCE[effectiveImportance(t)].label}）`).join('\n'));
    if (goals.length) parts.push('【目标】\n'+goals.map(g=>`${g.name}（${g.period==='week'?'每周':'每月'} ${g.freq} 次，已完成 ${Math.min(goalCount(g),g.freq)}/${g.freq}）`).join('\n'));
    const j = await ai({messages:[
      {role:'system',content:'你是主人的猫娘日程助手「小喵」。请用可爱的猫娘语气（适当用「喵」「主人」等口癖，但不要过度堆砌）为主人写一段今日纪要，语气温暖、给足情绪价值（关心、鼓励、卖萌）。把重要内容（具体时间、事件名称、截止日期、紧急事项、目标进度）用 **双星号** 包起来加粗。用中文，160字以内，可以分1-2小段，只输出纪要正文，不要标题或序号。'},
      {role:'user',content:`今天是 ${iso}（${WD[parse(iso).getDay()]}）。我的今日信息：\n${parts.join('\n\n')}`}
    ],temperature:0.8});
    const text = (j.choices[0].message.content||'').trim();
    previewCache[iso] = text;
    if (document.getElementById('aiPreviewBody')===el){ el.className='ai-body'; el.innerHTML = mdBold(text); }
  } catch(e){
    el.className = 'ai-body err'; el.textContent = '纪要生成失败：'+e.message;
  }
}
function mdBold(text){
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/* ---------- 日历 ---------- */
function renderCalendar(v){
  const y=monthCursor.getFullYear(), m=monthCursor.getMonth();
  const first = new Date(y,m,1);
  const gridStart = startOfWeek(first);
  const tIso = todayIso();
  let html = '<div class="calendar">';
  html += `<div class="cal-head"><span class="ttl">${y}年${m+1}月</span><div class="nav">`;
  html += `<button class="navbtn" id="calPrev">‹</button><button class="today-btn" id="calToday">今天</button><button class="navbtn" id="calNext">›</button></div></div>`;
  html += `<div class="cal-weekdays">${['一','二','三','四','五','六','日'].map(w=>`<div>周${w}</div>`).join('')}</div>`;
  html += `<div class="cal-grid">`;
  for(let i=0;i<42;i++){
    const d=addDays(gridStart,i), iso=fmt(d);
    const out = d.getMonth()!==m;
    const isToday = iso===tIso;
    const list = eventsOn(iso);
    const tds = liveTodos().filter(t=>t.ddl===iso && t.status!=='done');
    const cls=['cal-cell',out?'out':'',(d.getDay()===0||d.getDay()===6)?'wk':'',isToday?'today':''].filter(Boolean).join(' ');
    const dots = list.slice(0,5).map(e=>`<span class="dot" style="background:${e.color}"></span>`).join('')
      + tds.slice(0,3).map(t=>`<span class="dot tdot" style="background:${IMPORTANCE[effectiveImportance(t)].color}"></span>`).join('');
    html += `<div class="${cls}" data-date="${iso}"><div class="num tnum">${d.getDate()}</div>`;
    html += `<div class="dots">${dots}</div>`;
    if (list.length+tds.length>5) html += `<div class="count">+${list.length+tds.length-5}</div>`;
    html += `</div>`;
  }
  html += `</div></div>`;
  v.innerHTML = html;
}

/* ---------- 时间轴 ---------- */
function renderTimeline(v){
  const tIso = todayIso();
  const days=[]; for(let i=0;i<7;i++) days.push(addDays(weekCursor,i));
  const weekIsos = days.map(d=>fmt(d));
  const weekTodos = liveTodos().filter(t=>t.status!=='done' && weekIsos.includes(t.ddl));
  let html = '<div class="timeline">';
  html += `<div class="tl-head"><span class="ttl">本周</span>`;
  html += `<div class="nav"><button class="navbtn" id="wkPrev">‹</button><button class="today-btn" id="wkToday">回到本周</button><button class="navbtn" id="wkNext">›</button></div></div>`;
  if (weekTodos.length){
    html += `<div class="tl-todos"><span class="tl-todos-title">待办（点击名称查看详情）</span><div class="tl-todo-chips">`;
    weekTodos.forEach(t=>{
      const c = IMPORTANCE[effectiveImportance(t)].color;
      html += `<button class="todo-chip" data-todo="${t.id}" style="--c:${c}">${esc(t.name)}<span class="c-ddl tnum">${t.ddl.slice(5)}</span></button>`;
    });
    html += `</div></div>`;
  }
  html += `<div class="tl-hint">点击时间条进入当天视图 · 点击空白处按该时间新建 · 竖线为待办 DDL</div>`;
  html += `<div class="tl-scroll" id="tlScroll">`;
  days.forEach(d=>{
    const iso=fmt(d), isToday=iso===tIso;
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
    weekTodos.filter(t=>t.ddl===iso).forEach(t=>{
      const c = IMPORTANCE[effectiveImportance(t)].color;
      html += `<div class="tl-todo-line" data-todo="${t.id}" style="background:${c}" title="${esc(t.name)} · ddl"></div>`;
    });
    html += `</div></div>`;
  });
  html += `</div></div>`;
  v.innerHTML = html;
}

/* ---------- 目标 / 待办 界面 ---------- */
function renderGoals(v){
  const range = periodRange(taskMode);
  const today = todayIso();
  const all = liveTodos();
  const pending = all.filter(t=>t.status!=='done' && t.ddl<=range.end).sort((a,b)=>a.ddl.localeCompare(b.ddl));
  const doneToday = all.filter(t=>t.status==='done' && t.doneAt===today).sort((a,b)=>a.ddl.localeCompare(b.ddl));
  const goals = (db.goals||[]).filter(g=>g.period===taskMode);

  let html = '<div class="tasks">';
  html += `<div class="tasks-head"><span class="ttl">目标 / 待办</span>`;
  html += `<div class="seg" id="taskModeSeg"><button data-mode="week" class="${taskMode==='week'?'on':''}">本周</button><button data-mode="month" class="${taskMode==='month'?'on':''}">本月</button></div>`;
  html += `<button class="add-btn" id="taskAddBtn" title="添加待办或目标">＋</button></div>`;

  html += `<div class="task-section"><div class="section-title">待办 <span class="cnt">${pending.length+doneToday.length}</span></div>`;
  if (!pending.length && !doneToday.length) html += `<div class="empty small"><div class="big">✅</div>${taskMode==='week'?'本周':'本月'}还没有待办。</div>`;
  pending.forEach(t=>{
    const imp = effectiveImportance(t);
    const c = IMPORTANCE[imp].color;
    html += `<div class="todo-row" data-todo="${t.id}"><span class="bar" style="background:${c}"></span>`;
    html += `<div class="body"><div class="name">${esc(t.name)}</div><div class="meta tnum">${t.ddl} · ${IMPORTANCE[imp].label}${t.description?' · '+esc(t.description):''}</div></div>`;
    html += statusSegHtml(t);
    html += `</div>`;
  });
  doneToday.forEach(t=>{
    const c = IMPORTANCE[t.importance].color;
    html += `<div class="todo-row done" data-todo="${t.id}"><span class="bar" style="background:${c}"></span>`;
    html += `<div class="body"><div class="name done-name">${esc(t.name)}</div><div class="meta tnum">${t.ddl} · 已完成（明天消失）</div></div>`;
    html += statusSegHtml(t);
    html += `</div>`;
  });
  html += `</div>`;

  html += `<div class="task-section"><div class="section-title">目标 <span class="cnt">${goals.length}</span></div>`;
  if (!goals.length) html += `<div class="empty small"><div class="big">🎯</div>还没有${taskMode==='week'?'每周':'每月'}目标。</div>`;
  goalsSorted().filter(g=>g.period===taskMode).forEach(g=>{
    const c = goalCount(g), done = c>=g.freq;
    html += `<div class="goal-row" data-goal="${g.id}"><div class="body">`;
    html += `<div class="name">${done?'<span class="done-check">✓</span> ':''}${esc(g.name)}</div>`;
    html += `<div class="meta">${g.period==='week'?'每周':'每月'} ${g.freq} 次${g.description?' · '+esc(g.description):''}</div></div>`;
    html += `<div class="goal-slots">`;
    for(let i=1;i<=g.freq;i++) html += `<button class="goal-slot ${i<=c?'on':''}" data-goal="${g.id}" data-slot="${i}"></button>`;
    html += `</div><span class="goal-status ${done?'done':''}">${goalStatus(g)}</span>`;
    html += `<button class="del" data-del-goal="${g.id}" title="删除">✕</button></div>`;
  });
  html += `</div>`;
  html += `</div>`;
  v.innerHTML = html;
}
function statusSegHtml(t){
  return `<div class="status-seg" data-id="${t.id}">`+
    ['todo','doing','done'].map(s=>`<button class="status-btn ${t.status===s?'on':''}" data-status="${s}">${STATUS[s]}</button>`).join('')+
    `</div>`;
}

/* ---------- 待办详情 ---------- */
function openTodoDetail(id){
  const t = db.todos.find(x=>x.id===id); if(!t) return;
  detailTodoId = id;
  const imp = effectiveImportance(t);
  document.getElementById('tdName').textContent = t.name;
  document.getElementById('tdDdl').textContent = t.ddl;
  const tag = document.getElementById('tdImportance');
  tag.textContent = IMPORTANCE[imp].label;
  tag.style.background = IMPORTANCE[imp].color;
  document.getElementById('tdDesc').textContent = t.description || '（无）';
  document.getElementById('tdStatus').innerHTML = statusSegHtml(t);
  document.getElementById('todoDetailOverlay').classList.add('show');
}
function renderDetailStatus(){
  const t = db.todos.find(x=>x.id===detailTodoId); if(!t) return;
  const el = document.getElementById('tdStatus'); if(!el) return;
  el.innerHTML = statusSegHtml(t);
}

/* ---------- 目标/待办 添加弹窗 ---------- */
function openTaskAdd(id, type){
  editingTaskId = id || null;
  taskType = type || 'todo';
  document.getElementById('taskTitle').textContent = id ? (taskType==='goal'?'编辑目标':'编辑待办') : '添加待办 / 目标';
  document.getElementById('taskSave').textContent = id ? '保存' : '添加';
  document.getElementById('taskTypeSeg').style.display = id ? 'none' : '';
  setTaskType(taskType);
  const today = todayIso();
  if (id){
    if (taskType==='goal'){
      const g = db.goals.find(x=>x.id===id);
      document.getElementById('tName').value = g.name;
      document.getElementById('gPeriod').value = g.period;
      document.getElementById('gFreq').value = g.freq;
      document.getElementById('gDesc').value = g.description||'';
    } else {
      const t = db.todos.find(x=>x.id===id);
      document.getElementById('tName').value = t.name;
      document.getElementById('tDdl').value = t.ddl;
      document.getElementById('tImportance').value = t.importance;
      document.getElementById('tDesc').value = t.description||'';
    }
  } else {
    document.getElementById('tName').value = '';
    document.getElementById('tDdl').value = today;
    document.getElementById('tImportance').value = 'important';
    document.getElementById('tDesc').value = '';
    document.getElementById('gPeriod').value = 'week';
    document.getElementById('gFreq').value = 3;
    document.getElementById('gDesc').value = '';
  }
  document.getElementById('taskOverlay').classList.add('show');
  setTimeout(()=>document.getElementById('tName').focus(),0);
}
function setTaskType(type){
  taskType = type;
  document.querySelectorAll('#taskTypeSeg button').forEach(b=>b.classList.toggle('on', b.dataset.type===type));
  document.getElementById('todoFields').style.display = type==='todo'?'':'none';
  document.getElementById('goalFields').style.display = type==='goal'?'':'none';
  document.getElementById('tName').placeholder = type==='todo'?'例如：提交周报':'例如：每周健身';
}

/* ============================================================
   增删改（日程事件）
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
    document.getElementById('fDate').value = date || todayIso();
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
  const today = todayIso();
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
  { type:'function', function:{ name:'add_todo', description:'添加一条待办（有截止日期）', parameters:{ type:'object', properties:{ name:{type:'string',description:'待办名称'}, ddl:{type:'string',description:'截止日期 YYYY-MM-DD'}, importance:{type:'string',description:'重要程度，可选值：normal/important/urgent/critical，默认 important',enum:['normal','important','urgent','critical']}, description:{type:'string'} }, required:['name','ddl'] } } },
  { type:'function', function:{ name:'add_goal', description:'添加一个目标（每周/每月 N 次）', parameters:{ type:'object', properties:{ name:{type:'string',description:'目标名称'}, period:{type:'string',description:'周期 week(每周) 或 month(每月)',enum:['week','month']}, freq:{type:'integer',description:'每周/每月几次'}, description:{type:'string'} }, required:['name','period','freq'] } } },
  { type:'function', function:{ name:'remove_todo', description:'删除待办（按名称匹配）', parameters:{ type:'object', properties:{ name:{type:'string',description:'要删除的待办名称（支持部分匹配）'} }, required:['name'] } } },
  { type:'function', function:{ name:'remove_goal', description:'删除目标（按名称匹配）', parameters:{ type:'object', properties:{ name:{type:'string',description:'要删除的目标名称（支持部分匹配）'} }, required:['name'] } } },
];
function initChatSystem(){
  chatHistory = [{role:'system',content:`你是用户的猫娘日程助手「小喵」，帮他管理日程、待办、目标。今天是 ${todayIso()}（${WD[new Date().getDay()]}）。回答用中文、简洁，可以带一点可爱的猫娘语气（「喵」「主人」），但务必准确。需要查看/增删日程、待办、目标时调用相应工具（add_event/add_todo/add_goal/remove_event/remove_todo/remove_goal/list_events）；操作完成后用一句话告知结果。涉及「什么时候前/截止」通常应建为待办 add_todo；涉及「每周/每月做几次」应建为目标 add_goal。`}];
}
async function runTool(name, args){
  const today = todayIso();
  if (name==='list_events'){
    const d = args.date || today;
    const list = eventsOn(d);
    const tds = liveTodos().filter(t=>t.ddl===d && t.status!=='done');
    let out = [];
    if (!list.length && !tds.length) return { result:`${d} 没有日程或待办` };
    if (list.length) out.push('日程：'+list.map(e=>`${e.start} ${e.name}（${durLabel(e.duration)}）`).join('；'));
    if (tds.length) out.push('待办：'+tds.map(t=>`${t.name}（ddl ${t.ddl}，${IMPORTANCE[effectiveImportance(t)].label}）`).join('；'));
    return { result: out.join('\n') };
  }
  if (name==='add_event'){
    const ev = { id:uid(), name:args.name, date:args.date||today, start:args.start||'09:00', duration:args.duration||60, color:pickColor(), description:args.description||'' };
    db.events.push(ev);
    return { ok:true, added:`日程 ${ev.date} ${ev.start} ${ev.name}` };
  }
  if (name==='remove_event'){
    const before = db.events.length;
    db.events = db.events.filter(e=>!(e.date===(args.date||today) && e.name.includes(args.name||'')));
    return { ok:true, removed: before - db.events.length };
  }
  if (name==='add_todo'){
    const t = { id:uid(), name:args.name, ddl:args.ddl||today, description:args.description||'', importance:['normal','important','urgent','critical'].includes(args.importance)?args.importance:'important', status:'todo', doneAt:null, createdAt:Date.now() };
    db.todos.push(t);
    return { ok:true, added:`待办 ${t.name}（ddl ${t.ddl}）` };
  }
  if (name==='add_goal'){
    const g = { id:uid(), name:args.name, description:args.description||'', period:args.period==='month'?'month':'week', freq:Math.max(1,parseInt(args.freq,10)||1), completions:{}, createdAt:Date.now() };
    db.goals.push(g);
    return { ok:true, added:`目标 ${g.name}（${g.period==='week'?'每周':'每月'} ${g.freq} 次）` };
  }
  if (name==='remove_todo'){
    const before = db.todos.length;
    db.todos = db.todos.filter(t=>!t.name.includes(args.name||''));
    return { ok:true, removed: before - db.todos.length };
  }
  if (name==='remove_goal'){
    const before = db.goals.length;
    db.goals = db.goals.filter(g=>!g.name.includes(args.name||''));
    return { ok:true, removed: before - db.goals.length };
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
          const fn = tc.function.name;
          if (r.added) actions.push('＋ '+r.added);
          if (r.removed) actions.push('－ 已删除 '+r.removed+' 项');
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
  // 添加日程
  if (e.target.closest('#addBtn')){ openAdd(null, dayDate || undefined, undefined); return; }
  // 重新生成纪要
  if (e.target.closest('#regenBtn')){ delete previewCache[todayIso()]; render(); return; }
  // 目标/待办：添加按钮
  if (e.target.closest('#taskAddBtn')){ openTaskAdd(null, 'todo'); return; }
  // 目标/待办：周/月切换
  const modeBtn = e.target.closest('#taskModeSeg button');
  if (modeBtn){ taskMode = modeBtn.dataset.mode; render(); return; }
  // 待办状态切换
  const stBtn = e.target.closest('.status-btn');
  if (stBtn){
    await setTodoStatus(stBtn.parentElement.dataset.id, stBtn.dataset.status);
    render();
    if (document.getElementById('todoDetailOverlay').classList.contains('show')) renderDetailStatus();
    return;
  }
  // 目标完成槽点击
  const slot = e.target.closest('.goal-slot');
  if (slot){
    const g = db.goals.find(x=>x.id===slot.dataset.goal); if(!g) return;
    const key = periodKey(g.period);
    const c = g.completions[key] || 0;
    const i = parseInt(slot.dataset.slot,10);
    g.completions[key] = Math.max(0, Math.min(g.freq, i===c ? i-1 : i));
    await saveData(); render(); return;
  }
  // 删除目标
  const delG = e.target.closest('[data-del-goal]');
  if (delG){ db.goals = db.goals.filter(x=>x.id!==delG.dataset.delGoal); await saveData(); render(); toast('已删除目标'); return; }
  // 待办 → 详情
  const chip = e.target.closest('.todo-chip[data-todo]');
  if (chip){ openTodoDetail(chip.dataset.todo); return; }
  const line = e.target.closest('.tl-todo-line[data-todo]');
  if (line){ openTodoDetail(line.dataset.todo); return; }
  const todoRow = e.target.closest('.todo-row[data-todo]');
  if (todoRow){ openTodoDetail(todoRow.dataset.todo); return; }
  // 目标 → 编辑
  const goalRow = e.target.closest('.goal-row[data-goal]');
  if (goalRow){ openTaskAdd(goalRow.dataset.goal, 'goal'); return; }
  // 删除日程
  const del=e.target.closest('[data-del]');
  if (del){ db.events=db.events.filter(x=>x.id!==del.dataset.del); await saveData(); render(); toast('已删除'); return; }
  // 编辑日程（点行）
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

async function setTodoStatus(id, status){
  const t = db.todos.find(x=>x.id===id); if(!t) return;
  t.status = status;
  t.doneAt = (status==='done') ? todayIso() : null;
  await saveData();
}

// 日历 / 时间轴导航
document.getElementById('view').addEventListener('click', e=>{
  if (e.target.closest('#calPrev')){ monthCursor=addMonths(monthCursor,-1); render(); }
  else if (e.target.closest('#calNext')){ monthCursor=addMonths(monthCursor,1); render(); }
  else if (e.target.closest('#calToday')){ monthCursor=new Date(); render(); }
  else if (e.target.closest('#wkPrev')){ weekCursor=addDays(weekCursor,-7); render(); }
  else if (e.target.closest('#wkNext')){ weekCursor=addDays(weekCursor,7); render(); }
  else if (e.target.closest('#wkToday')){ weekCursor=startOfWeek(new Date()); render(); }
});

// 日程添加弹窗
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

// 目标/待办 添加弹窗
document.getElementById('taskTypeSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  setTaskType(b.dataset.type);
});
document.getElementById('taskCancel').onclick=()=>document.getElementById('taskOverlay').classList.remove('show');
document.getElementById('taskSave').onclick=async ()=>{
  const name=document.getElementById('tName').value.trim();
  if(!name){ toast('请填写名称'); return; }
  if (taskType==='todo'){
    const ddl = document.getElementById('tDdl').value;
    if(!ddl){ toast('请填写截止日期 DDL'); return; }
    const data = {
      name,
      ddl,
      importance: document.getElementById('tImportance').value,
      description: document.getElementById('tDesc').value.trim(),
    };
    if (editingTaskId){
      Object.assign(db.todos.find(x=>x.id===editingTaskId), data);
      toast('已保存待办');
    } else {
      db.todos.push({id:uid(), ...data, status:'todo', doneAt:null, createdAt:Date.now()});
      toast('已添加待办');
    }
  } else {
    const data = {
      name,
      period: document.getElementById('gPeriod').value,
      freq: Math.max(1, Math.min(30, parseInt(document.getElementById('gFreq').value,10)||1)),
      description: document.getElementById('gDesc').value.trim(),
    };
    if (editingTaskId){
      const g = db.goals.find(x=>x.id===editingTaskId);
      Object.assign(g, data);
      if (g.completions === undefined) g.completions = {};
      toast('已保存目标');
    } else {
      db.goals.push({id:uid(), ...data, completions:{}, createdAt:Date.now()});
      toast('已添加目标');
    }
  }
  await saveData();
  document.getElementById('taskOverlay').classList.remove('show');
  render();
};

// 待办详情弹窗
document.getElementById('tdClose').onclick=()=>document.getElementById('todoDetailOverlay').classList.remove('show');
document.getElementById('tdEdit').onclick=()=>{
  const t = db.todos.find(x=>x.id===detailTodoId); if(!t) return;
  document.getElementById('todoDetailOverlay').classList.remove('show');
  openTaskAdd(t.id, 'todo');
};
document.getElementById('tdDelete').onclick=async ()=>{
  if(!detailTodoId) return;
  db.todos = db.todos.filter(x=>x.id!==detailTodoId);
  await saveData();
  document.getElementById('todoDetailOverlay').classList.remove('show');
  render(); toast('已删除待办');
};
// 详情弹窗内的状态切换（弹窗在 #view 之外，需独立委托）
document.getElementById('tdStatus').addEventListener('click', async e=>{
  const b = e.target.closest('.status-btn'); if(!b) return;
  await setTodoStatus(b.parentElement.dataset.id, b.dataset.status);
  render();
  renderDetailStatus();
});

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
    document.getElementById('taskOverlay').classList.remove('show');
    document.getElementById('todoDetailOverlay').classList.remove('show');
  }
});

/* ---------- 启动 ---------- */
(async function init(){
  await loadData();
  initChatSystem();
  render();
})();
