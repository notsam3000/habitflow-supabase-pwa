const { createClient } = window.supabase;
const cfg = window.HABITFLOW_CONFIG || {};
const configured = cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY &&
  !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");

const sb = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;
const LOCAL_KEY = "habitflow-local-v2";

let data = { habits: [], done: {} };
let selected = new Date();
let weekOffset = 0;
let authMode = "signin";
let currentUser = null;
let channel = null;

function key(d) {
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function monday(d){const x=new Date(d);x.setHours(0,0,0,0);const n=x.getDay();x.setDate(x.getDate()+(n===0?-6:1-n));return x}
function same(a,b){return key(a)===key(b)}
function esc(s){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function localSave(){localStorage.setItem(LOCAL_KEY,JSON.stringify(data))}
function setStatus(text, working=false){const el=document.getElementById("syncStatus");if(el){el.textContent=text;el.classList.toggle("working",working)}}

function showAuth(show){
  document.getElementById("authPage").classList.toggle("hidden",!show);
  document.querySelector(".app").classList.toggle("hidden",show);
  document.querySelector(".bottom-nav").classList.toggle("hidden",show);
}

function showConfigMessage(){
  showAuth(true);
  document.getElementById("authTitle").textContent="One small setup step";
  document.getElementById("authSubtitle").textContent="Open config.js and paste your Supabase Project URL and Publishable key.";
  document.getElementById("authForm").classList.add("hidden");
  document.getElementById("authSwitch").classList.add("hidden");
  document.getElementById("authMessage").textContent="Your keys stay in your local copy of the app. Never use a secret/service-role key here.";
}

async function init(){
  if(!sb){showConfigMessage();return}
  const {data:sessionData}=await sb.auth.getSession();
  currentUser=sessionData.session?.user||null;
  if(currentUser){await startApp()}
  else showAuth(true);

  sb.auth.onAuthStateChange(async (_event,session)=>{
    currentUser=session?.user||null;
    if(currentUser) await startApp(); else {showAuth(true);if(channel){await sb.removeChannel(channel);channel=null}}
  });
}

async function startApp(){
  showAuth(false);
  document.getElementById("userEmail").textContent=currentUser.email||"";
  await pullCloud();
  subscribeRealtime();
  render();
}

async function pullCloud(){
  setStatus("Syncing…",true);
  const {data:habits,error:he}=await sb.from("habits").select("id,name,created_at").eq("user_id",currentUser.id).order("created_at");
  if(he){setStatus("Sync error");console.error(he);return}
  const {data:completions,error:ce}=await sb.from("habit_completions").select("habit_id,completed_date").eq("user_id",currentUser.id);
  if(ce){setStatus("Sync error");console.error(ce);return}
  data.habits=(habits||[]).map(h=>({id:h.id,name:h.name}));
  data.done={};
  (completions||[]).forEach(c=>{data.done[c.habit_id]??={};data.done[c.habit_id][c.completed_date]=true});
  localSave();
  setStatus("Synced");
}

function subscribeRealtime(){
  if(channel) sb.removeChannel(channel);
  channel=sb.channel("habitflow-user-"+currentUser.id)
    .on("postgres_changes",{event:"*",schema:"public",table:"habits",filter:"user_id=eq."+currentUser.id},()=>pullCloud().then(render))
    .on("postgres_changes",{event:"*",schema:"public",table:"habit_completions",filter:"user_id=eq."+currentUser.id},()=>pullCloud().then(render))
    .subscribe();
}

async function addHabit(name){
  const clean=name.trim();if(!clean)return;
  setStatus("Saving…",true);
  const {error}=await sb.from("habits").insert({user_id:currentUser.id,name:clean});
  if(error){setStatus("Could not save");alert(error.message);return}
  await pullCloud();
  render();
}

async function toggle(id){
  const k=key(selected);
  const wasDone=!!data.done[id]?.[k];
  setStatus("Saving…",true);
  if(wasDone){
    const {error}=await sb.from("habit_completions").delete().eq("user_id",currentUser.id).eq("habit_id",id).eq("completed_date",k);
    if(error){setStatus("Could not save");alert(error.message);return}
    if(data.done[id]) delete data.done[id][k];
  }else{
    const {error}=await sb.from("habit_completions").insert({user_id:currentUser.id,habit_id:id,completed_date:k});
    if(error){setStatus("Could not save");alert(error.message);return}
    data.done[id]??={};data.done[id][k]=true;
  }
  localSave();setStatus("Synced");render();
}

async function rename(id){
  const h=data.habits.find(x=>x.id===id);if(!h)return;
  const n=prompt("Rename habit:",h.name);if(n===null)return;
  const clean=n.trim();if(!clean)return;
  setStatus("Saving…",true);
  const {error}=await sb.from("habits").update({name:clean}).eq("id",id).eq("user_id",currentUser.id);
  if(error){setStatus("Could not save");alert(error.message);return}
  h.name=clean;localSave();setStatus("Synced");render();
}

async function removeHabit(id){
  if(!confirm("Delete this habit and its history?"))return;
  setStatus("Deleting…",true);
  const {error}=await sb.from("habits").delete().eq("id",id).eq("user_id",currentUser.id);
  if(error){setStatus("Could not delete");alert(error.message);return}
  data.habits=data.habits.filter(h=>h.id!==id);delete data.done[id];localSave();setStatus("Synced");render();
}

function render(){
  const start=addDays(monday(new Date()),weekOffset*7);
  const days=Array.from({length:7},(_,i)=>addDays(start,i));
  document.getElementById("monthLabel").textContent=start.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  document.getElementById("week").innerHTML=days.map(d=>{
    const complete=data.habits.length>0&&data.habits.every(h=>data.done[h.id]?.[key(d)]);
    return `<button class="day ${same(d,selected)?"selected":""}" data-date="${key(d)}">
      <span>${d.toLocaleDateString(undefined,{weekday:"short"}).slice(0,3)}</span><strong>${d.getDate()}</strong>
      ${same(d,new Date())?'<span class="mark"></span>':complete?'<span class="done-dot"></span>':""}
    </button>`;
  }).join("");

  const sk=key(selected),count=data.habits.filter(h=>data.done[h.id]?.[sk]).length;
  document.getElementById("completionSummary").textContent=`${count} of ${data.habits.length} completed`;
  document.getElementById("selectedLabel").textContent=selected.toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});
  document.getElementById("habitList").innerHTML=data.habits.length?data.habits.map(h=>`
    <div class="habit">
      <button class="check ${data.done[h.id]?.[sk]?"done":""}" data-toggle="${h.id}">${data.done[h.id]?.[sk]?"✓":""}</button>
      <button class="name" data-toggle="${h.id}">${esc(h.name)}</button>
      <button class="more" data-menu="${h.id}">⋯</button>
    </div>`).join(""):`<div class="empty"><strong>No habits yet</strong>Add your first habit and keep today simple.<br><button class="primary" id="emptyAdd">Add a habit</button></div>`;
  renderStats();
}

function renderStats(){
  const days=Array.from({length:28},(_,i)=>addDays(new Date(),-27+i));
  let possible=data.habits.length*28,done=0;
  data.habits.forEach(h=>days.forEach(d=>{if(data.done[h.id]?.[key(d)])done++}));
  document.getElementById("completionRate").textContent=possible?Math.round(done/possible*100)+"%":"0%";
  let ss=data.habits.map(h=>{let n=0,d=new Date();while(data.done[h.id]?.[key(d)]){n++;d=addDays(d,-1)}return n});
  document.getElementById("bestStreak").textContent=ss.length?Math.max(...ss):0;
  document.getElementById("heatmap").innerHTML=days.map(d=>{
    const n=data.habits.filter(h=>data.done[h.id]?.[key(d)]).length;
    const l=data.habits.length?Math.ceil(n/data.habits.length*4):0;
    return `<div class="heat ${l?"l"+l:""}" title="${key(d)} · ${n} completed"></div>`;
  }).join("");
  document.getElementById("habitStats").innerHTML=data.habits.length?data.habits.map(h=>{
    const n=days.filter(d=>data.done[h.id]?.[key(d)]).length,p=Math.round(n/28*100);
    return `<div class="stat-row"><i class="stat-dot"></i><span class="stat-name">${esc(h.name)}</span><div class="bar"><span style="width:${p}%"></span></div><strong>${p}%</strong></div>`;
  }).join(""):`<p style="color:var(--muted)">Add a habit to see statistics.</p>`;
}

function modal(html){
  const layer=document.getElementById("modalLayer");
  layer.innerHTML=`<div class="modal-bg" id="modalBg"><div class="modal">${html}</div></div>`;
  document.getElementById("modalBg").addEventListener("click",e=>{if(e.target.id==="modalBg")closeModal()});
}
function closeModal(){document.getElementById("modalLayer").innerHTML=""}

function addModal(){
  modal(`<div class="modal-head"><h2>New habit</h2><button class="circle-btn" id="close">×</button></div>
  <form id="addForm"><label>Habit name</label><input id="habitInput" autofocus placeholder="e.g. Read 20 minutes"><button class="primary">Add habit</button></form>`);
  document.getElementById("close").onclick=closeModal;
  document.getElementById("addForm").onsubmit=async e=>{e.preventDefault();const n=document.getElementById("habitInput").value;await addHabit(n);if(n.trim())closeModal()};
}
function menu(id){
  const h=data.habits.find(x=>x.id===id);
  modal(`<div class="modal-head"><h2>${esc(h.name)}</h2><button class="circle-btn" id="close">×</button></div>
  <button class="action" id="rename">✎ <span>Rename</span></button>
  <button class="action danger" id="delete">⌫ <span>Delete habit</span></button>`);
  document.getElementById("close").onclick=closeModal;
  document.getElementById("rename").onclick=async()=>{closeModal();await rename(id)};
  document.getElementById("delete").onclick=async()=>{closeModal();await removeHabit(id)};
}
function settings(){
  modal(`<div class="modal-head"><h2>Account</h2><button class="circle-btn" id="close">×</button></div>
  <p style="color:var(--muted);font-size:13px;margin:0 0 15px">Signed in as <b>${esc(currentUser.email||"")}</b></p>
  <button class="action" id="refresh">↻ <span>Sync now</span></button>
  <button class="action danger" id="logout">⇥ <span>Sign out</span></button>
  <p class="note">Your habits are stored in Supabase and can sync across devices when you sign in with the same account.</p>`);
  document.getElementById("close").onclick=closeModal;
  document.getElementById("refresh").onclick=async()=>{closeModal();await pullCloud();render()};
  document.getElementById("logout").onclick=async()=>{closeModal();await sb.auth.signOut()};
}

async function authSubmit(e){
  e.preventDefault();
  const email=document.getElementById("authEmail").value.trim();
  const password=document.getElementById("authPassword").value;
  const msg=document.getElementById("authMessage"),btn=document.getElementById("authSubmit");
  msg.textContent="Working…";btn.disabled=true;
  const result=authMode==="signin"
    ? await sb.auth.signInWithPassword({email,password})
    : await sb.auth.signUp({email,password});
  btn.disabled=false;
  if(result.error){msg.textContent=result.error.message;return}
  if(authMode==="signup"&&!result.data.session) msg.textContent="Account created. Check your email to confirm it, then sign in.";
  else msg.textContent="";
}

document.getElementById("authForm").addEventListener("submit",authSubmit);
document.getElementById("authSwitch").onclick=()=>{
  authMode=authMode==="signin"?"signup":"signin";
  document.getElementById("authTitle").textContent=authMode==="signin"?"Welcome back":"Create your account";
  document.getElementById("authSubtitle").textContent=authMode==="signin"?"Sign in to sync your habits across devices.":"Create one account for your phone and PC.";
  document.getElementById("authSubmit").textContent=authMode==="signin"?"Sign in":"Sign up";
  document.getElementById("authSwitch").textContent=authMode==="signin"?"Need an account? Sign up":"Already have an account? Sign in";
  document.getElementById("authMessage").textContent="";
};
document.getElementById("prevWeek").onclick=()=>{weekOffset--;render()};
document.getElementById("nextWeek").onclick=()=>{weekOffset++;render()};
document.getElementById("monthLabel").onclick=()=>{weekOffset=0;selected=new Date();render()};
document.getElementById("todayBtn").onclick=()=>{weekOffset=0;selected=new Date();render()};
document.getElementById("addBtn").onclick=addModal;
document.getElementById("settingsBtn").onclick=settings;
document.querySelector(".bottom-nav").onclick=e=>{
  const b=e.target.closest(".nav-item");if(!b)return;
  const p=b.dataset.page;
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x===b));
  document.getElementById("homePage").classList.toggle("hidden",p!=="home");
  document.getElementById("statsPage").classList.toggle("hidden",p!=="stats");
  document.getElementById("pageTitle").textContent=p==="home"?"Today":"Stats";
};
document.addEventListener("click",e=>{
  const d=e.target.closest("[data-date]");if(d){const [y,m,day]=d.dataset.date.split("-").map(Number);selected=new Date(y,m-1,day);render()}
  const t=e.target.closest("[data-toggle]");if(t)toggle(t.dataset.toggle);
  const m=e.target.closest("[data-menu]");if(m)menu(m.dataset.menu);
  if(e.target.id==="emptyAdd")addModal();
});
init();