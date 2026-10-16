(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LETTERS = ["A","B","C","D","E","F"];
const store = {
  get(k, d){ try { const v = localStorage.getItem("tt:"+k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem("tt:"+k, JSON.stringify(v)); } catch {} }
};
const norm = s => String(s||"").toLowerCase().replace(/[‘’`ʻʼ']/g,"'").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu," ").trim();
const shuffle = a => { a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const pct = (a,b) => b ? Math.round(a*100/b) : 0;
const grade = p => p>=86?5:p>=71?4:p>=56?3:2;
const fmtTime = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const fmtDate = t => { try { return new Date(t).toLocaleString("uz-UZ",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}); } catch { return ""; } };

/* ---------- api ---------- */
async function api(method, url, body){
  let res;
  try { res = await fetch(url, { method, headers: body ? { "Content-Type":"application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials:"same-origin" }); }
  catch { throw new Error("Server bilan aloqa yo'q. Internetni tekshiring."); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== "/api/login"){ S.user = null; renderUser(); go("/"); }
  if (!res.ok) { const e = new Error(data.error || "Xatolik yuz berdi."); e.status = res.status; throw e; }
  return data;
}

/* ---------- ui helpers ---------- */
let toastT;
function toast(msg){ let t = $(".toast"); if (!t){ t = document.createElement("div"); t.className="toast"; t.setAttribute("role","status"); document.body.appendChild(t); } t.textContent = msg; t.hidden=false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, 3500); }
async function copy(text){ try { await navigator.clipboard.writeText(text); toast("Nusxalandi"); } catch { modal(`<h3>Nusxalang</h3><input id="cp" value="${esc(text)}" readonly><div class="row"><button class="primary" data-close>Yopish</button></div>`); $("#cp").select(); } }
function modal(html, onMount){
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg = $(".modal-bg", root);
  bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-close]")) closeModal(); });
  onMount && onMount($(".modal", root));
}
function closeModal(){ $("#modal-root").innerHTML = ""; }
function confirmDialog(text, okLabel, fn){
  modal(`<h3>Tasdiqlang</h3><p>${text}</p><div class="row"><button id="cy" style="background:var(--bad);border-color:var(--bad);color:#fff">${okLabel}</button><button data-close>Bekor qilish</button></div>`, m => {
    $("#cy",m).addEventListener("click", async () => { closeModal(); await fn(); });
  });
}
function downloadBlob(filename, data, type){
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const loaded = {};
function loadScript(src){ return loaded[src] ||= new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=()=>{ delete loaded[src]; rej(new Error("load")); }; document.head.appendChild(s); }); }
const XLSX_SRC = "/vendor/xlsx.full.min.js";
const MAMMOTH_SRC = "/vendor/mammoth.browser.min.js";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* ---------- state ---------- */
const S = { user:null, view:"loading", code:null, data:null, results:null, tab:"tests", quiz:null, filterSec:"all", search:"", importRows:null, groups:null };
let editing = null;
const sections = () => S.data?.sections || [];
const questions = () => S.data?.questions || [];
function secName(id){ const i = sections().findIndex(s=>s.id===id); return i<0 ? "Bo'limsiz" : `${i+1}. ${sections()[i].title}`; }
function qBySec(){ const m = {}; for (const q of questions()) (m[q.sectionId] ||= []).push(q); return m; }
const shareLink = () => `${location.origin}/g/${S.code}`;
const canEdit = () => !!S.data?.role.canEdit;

/* ---------- routing ---------- */
function go(path, replace){ if (location.pathname !== path) history[replace?"replaceState":"pushState"]({}, "", path); route(); }
window.addEventListener("popstate", route);
async function route(){
  closeModal(); clearInterval(tick);
  const m = location.pathname.match(/^\/g\/([A-Za-z0-9]{4,10})\/?$/);
  if (!S.user){ S.view = "auth"; S.pendingCode = m ? m[1].toUpperCase() : null; render(); return; }
  if (m){ const code = m[1].toUpperCase(); if (S.code !== code || S.view === "home" || S.view === "auth"){ S.tab = "tests"; S.importRows = null; S.members = null; } S.code = code; S.view = "group"; S.quiz = null; render(); await loadGroup(); return; }
  S.view = "home"; S.code = null; S.data = null; S.quiz = null; render(); loadGroups();
}
async function loadGroups(){
  try { S.groups = (await api("GET","/api/groups")).groups; } catch(e){ toast(e.message); S.groups = []; }
  if (S.view==="home") render();
}
async function loadGroup(){
  try { S.data = await api("GET", "/api/groups/"+S.code); S.groupError = null; }
  catch(e){ S.data = null; S.groupError = e.message; }
  if (S.view==="group") render();
  if (S.data) loadResults();
}
async function loadResults(){
  try { S.results = await api("GET", `/api/groups/${S.code}/results`); } catch(e){ toast(e.message); }
  if (S.view==="group" && (S.tab==="results" || S.tab==="tests")) render();
}

/* ---------- render ---------- */
function renderUser(){
  const b = $("#userbox");
  const theme = document.documentElement.dataset.theme;
  const themeBtn = `<button class="ghost small" data-act="theme" title="Mavzu rangini almashtirish">${theme==="dark"?"Yorug' rejim":"Tungi rejim"}</button>`;
  const ini = S.user ? (S.user.name||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase() : "";
  b.innerHTML = S.user ? `${themeBtn}${S.user.isAdmin?`<button class="ghost small" data-act="admin">Foydalanuvchilar</button>`:""}<button class="avatar-pill" data-act="profile" title="Profil va parol"><span class="avatar">${esc(ini)}</span><span class="nm">${esc(S.user.name)}</span></button><button class="ghost small" data-act="logout">Chiqish</button>`
    : `<nav class="lp-nav"><a href="#features">Imkoniyatlar</a><a href="#how">Qanday ishlaydi</a><a href="#donate">Qo'llab-quvvatlash</a></nav>${themeBtn}<button class="small" data-auth="login" data-scroll>Kirish</button><button class="primary small" data-auth="register" data-scroll>Ro'yxatdan o'tish</button>`;
  document.body.classList.toggle("is-landing", !S.user);
}
function render(){
  const v = $("#view");
  if (S.view==="auth") v.innerHTML = authHTML();
  else if (S.view==="home") v.innerHTML = homeHTML();
  else if (S.view==="group") v.innerHTML = groupHTML();
  else if (S.view==="quiz") v.innerHTML = quizHTML();
  else if (S.view==="done") v.innerHTML = doneHTML();
  afterRender();
}

/* ---------- auth ---------- */
let authMode = "login";
const CARD_NO = "9860350142606895";
const ICONS = {
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6M9 11h6"/>',
  shuffle:'<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
  file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13l2 4 2-4 2 4 2-4"/>',
  shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  bolt:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  trophy:'<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'
};
const ico = k => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;
function donateHTML(){ return `<section class="lp-band lp-donate" id="donate"><div class="lp-in donate-grid">
  <div class="stack">
    <span class="eyebrow">Qo'llab-quvvatlash</span>
    <h2>Loyihani qo'llab-quvvatlash</h2>
    <p class="muted">Platforma bepul va reklamasiz. Agar u sizga foydali bo'lsa, istalgan miqdorda yordam berib, uni rivojlantirishga hissa qo'shishingiz mumkin. Har bir yordam uchun rahmat!</p>
    <div class="row"><button class="primary amber" data-act="copy-card">Karta raqamini nusxalash</button></div>
  </div>
  <div class="bank-card" aria-label="Karta raqami ${CARD_NO}">
    <div class="spread"><span class="bc-chip"></span><b class="bc-brand">HUMO</b></div>
    <div class="bc-num">${CARD_NO.replace(/(\d{4})(?=\d)/g,"$1 ")}</div>
    <div class="spread"><span><small>TestPlatform</small>Qo'llab-quvvatlash kartasi</span><button class="bc-copy" data-act="copy-card">Nusxalash</button></div>
  </div></div></section>`; }
function authHTML(){
  const reg = authMode==="register";
  const feats = [["book","Bo'limlar bo'yicha test","Kitobning har bir bo'limi uchun alohida test va o'sha mavzuga oid savollar."],
    ["shuffle","Aralash test","Barcha mavzulardan tasodifiy savollar — imtihonga tayyorlanish uchun ideal."],
    ["file","Excel / Word import","Yuzlab savollarni bir yo'la yuklang: tayyor shablon bilan bir necha soniyada."],
    ["shield","Takror savollar rad etiladi","Bir xil savol ikki marta qo'shilmaydi — baza toza va tartibli qoladi."],
    ["bolt","Darhol natija","Har bir javobdan keyin to'g'ri yoki xatoligi ko'rinadi, oxirida 5 ballik baho."],
    ["trophy","Reyting va xatolar ustida ishlash","Guruh reytingi, eng qiyin savollar va faqat xatolarni qayta yechish."]];
  return `<div class="landing">
  <section class="lp-band lp-hero"><div class="lp-in hero-grid">
    <div class="stack hero-copy">
      <span class="badge">✦ O'quvchilar, talabalar va o'qituvchilar uchun</span>
      <h1>Kitob va fanlar bo'yicha testlar — <span class="grad-text">bir joyda, qulay va tez</span></h1>
      <p class="lead">Maktab o'quvchilari, kollej va texnikum talabalari, OTM talabalari, o'qituvchilar — kitob yoki fan bo'yicha tayyorlanayotgan har kim uchun. Guruh yarating, savollarni kiriting yoki Excel/Word'dan yuklang, havolani yuboring va birga yeching. Natijalar va reyting avtomatik saqlanadi.</p>
      <div class="row"><button class="primary amber lg" data-auth="register" data-scroll>Boshlash — bepul</button><button class="lg" data-auth="login" data-scroll>Kirish</button></div>
      <div class="trust"><span>✓ 5 ballik baho</span><span>✓ Excel / Word</span><span>✓ Telefon uchun qulay</span><span>✓ Tungi rejim</span></div>
    </div>
    <div class="panel auth" id="auth-card">
      ${S.pendingCode ? `<div class="notice info">Sizni guruhga taklif qilishdi. Testni yechish uchun kiring yoki ro'yxatdan o'ting.</div>` : ""}
      <h2>${reg?"Ro'yxatdan o'tish":"Kirish"}</h2>
      <div class="seg"><button data-auth="login" aria-pressed="${!reg}">Kirish</button><button data-auth="register" aria-pressed="${reg}">Ro'yxatdan o'tish</button></div>
      <form id="authform" class="stack">
        ${reg?`<label class="f">Ism familiya<input id="a-name" autocomplete="name" required placeholder="Masalan: Aliyev Vali"></label>`:""}
        <label class="f">Login<input id="a-user" autocomplete="username" required placeholder="masalan: vali_2005" autocapitalize="off"></label>
        <label class="f">Parol<input id="a-pass" type="password" autocomplete="${reg?"new-password":"current-password"}" required minlength="6"></label>
        <p class="err" id="a-err"></p>
        <button class="primary" type="submit">${reg?"Ro'yxatdan o'tish":"Kirish"}</button>
        ${reg?"":`<button type="button" class="ghost small forgot" data-act="forgot">Parol yoki loginni unutdingizmi?</button>`}
      </form>
    </div>
  </div></section>
  <section class="lp-band lp-features" id="features"><div class="lp-in stack" style="gap:28px">
    <div class="lp-head"><span class="eyebrow">Imkoniyatlar</span><h2>O'qish va tayyorlanish uchun kerak bo'lgan hammasi</h2></div>
    <div class="feat-grid">${feats.map(([i,t,d],k)=>`<div class="feat" style="--h:${[243,262,199,160,25,330][k]}"><span class="fi">${ico(i)}</span><h3>${t}</h3><p class="muted">${d}</p></div>`).join("")}</div>
  </div></section>
  <section class="lp-band lp-steps" id="how"><div class="lp-in stack" style="gap:28px">
    <div class="lp-head"><span class="eyebrow">Qanday ishlaydi</span><h2>Uch qadamda boshlang</h2></div>
    <div class="steps">
      <div class="step"><span class="sn">1</span><h3>Guruh yarating</h3><p class="muted">Kitob nomi va bo'limlarini kiriting — 30 ta bo'limni bir yo'la qo'shish mumkin.</p></div>
      <div class="step"><span class="sn">2</span><h3>Savollarni qo'shing</h3><p class="muted">Qo'lda yozing yoki Excel/Word faylidan import qiling.</p></div>
      <div class="step"><span class="sn">3</span><h3>Havolani ulashing</h3><p class="muted">Sheriklaringiz havola yoki kod orqali qo'shilib, testlarni yechadi.</p></div>
    </div>
    <div class="cta-strip"><div><h3>Hoziroq sinab ko'ring</h3><p>Ro'yxatdan o'tish bir daqiqa ham olmaydi.</p></div><button class="primary amber lg" data-auth="register" data-scroll>Ro'yxatdan o'tish</button></div>
  </div></section>
  ${donateHTML()}
  </div>`;
}
function sheetDemo(){ return `<div class="sheet-demo" aria-hidden="true">
  <div class="ln">1. <span class="bb">A</span><span class="bb ok">B</span><span class="bb">C</span><span class="bb">D</span> <span>to'g'ri</span></div>
  <div class="ln">2. <span class="bb no">A</span><span class="bb">B</span><span class="bb ok">C</span><span class="bb">D</span> <span>xato</span></div>
  <div class="ln">3. <span class="bb">A</span><span class="bb">B</span><span class="bb">C</span><span class="bb on">D</span> <span>…</span></div>
  <div class="ln">4. <span class="bb">A</span><span class="bb">B</span><span class="bb">C</span><span class="bb">D</span></div></div>`; }
async function submitAuth(e){
  e.preventDefault();
  const body = { username: $("#a-user").value.trim(), password: $("#a-pass").value };
  if (authMode==="register") body.name = $("#a-name").value.trim();
  const btn = $('#authform button[type=submit]'); btn.disabled = true;
  try {
    const r = await api("POST", authMode==="register" ? "/api/register" : "/api/login", body);
    S.user = r.user; renderUser();
    const code = S.pendingCode; S.pendingCode = null;
    go(code ? "/g/"+code : "/", true);
    if (r.recoveryCode) recoveryDialog(r.recoveryCode, true);
  } catch(err){ $("#a-err").textContent = err.message; btn.disabled = false; }
}

/* ---------- password recovery & profile ---------- */
function recoveryDialog(code, isNew){
  modal(`<h3>Parolni tiklash kodi</h3>
    <p>${isNew?"Hisobingiz yaratildi. ":""}Parolni unutsangiz, shu kod bilan yangi parol o'rnatasiz. Uni yozib oling yoki skrinshot qiling: kod faqat hozir ko'rsatiladi.</p>
    <div class="code recovery-code">${esc(code)}</div>
    <div class="row"><button id="rc-copy">Nusxalash</button><button class="primary" data-close>Yozib oldim</button></div>`, m => {
    $("#rc-copy",m).addEventListener("click", () => copy(code));
  });
}
function forgotDialog(){
  modal(`<h3>Parolni tiklash</h3>
    <p class="small muted">Ro'yxatdan o'tganda berilgan tiklash kodi bo'lsa, yangi parolni shu yerda o'rnating.</p>
    <form id="fg" class="stack">
      <label class="f">Login<input id="fg-user" autocomplete="username" autocapitalize="off" required value="${esc($("#a-user")?.value||"")}"></label>
      <label class="f">Tiklash kodi<input id="fg-code" autocapitalize="characters" autocomplete="off" required placeholder="XXXX-XXXX-XXXX"></label>
      <label class="f">Yangi parol<input id="fg-pass" type="password" autocomplete="new-password" required minlength="6"></label>
      <p class="err" id="fg-err"></p>
      <div class="row"><button class="primary" type="submit">Parolni yangilash</button><button type="button" data-close>Bekor qilish</button></div>
    </form>
    <div class="notice info">Kod yo'q yoki loginni unutdingizmi? Siz qo'shilgan guruh egasi (o'qituvchingiz) loginingizni ko'ra oladi va parolingizni tiklab bera oladi: guruh → Sozlamalar → A'zolar. O'qituvchilar sayt administratoriga murojaat qiladi.</div>`, m => {
    $("#fg",m).addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("button[type=submit]",m); btn.disabled = true;
      try {
        const r = await api("POST","/api/reset-password",{ username:$("#fg-user",m).value.trim(), code:$("#fg-code",m).value, password:$("#fg-pass",m).value });
        S.user = r.user; renderUser();
        const code = S.pendingCode; S.pendingCode = null;
        go(code ? "/g/"+code : "/", true);
        toast("Parol yangilandi");
        recoveryDialog(r.recoveryCode);
      } catch(err){ $("#fg-err",m).textContent = err.message; btn.disabled = false; }
    });
  });
}
function profileDialog(){
  modal(`<h3>${esc(S.user.name)}</h3>
    <p class="small muted">Login: <b>${esc(S.user.username)}</b></p>
    <form id="pw" class="stack">
      <input type="text" autocomplete="username" value="${esc(S.user.username)}" hidden readonly>
      <h4>Parolni o'zgartirish</h4>
      <label class="f">Hozirgi parol<input id="pw-cur" type="password" autocomplete="current-password" required></label>
      <label class="f">Yangi parol<input id="pw-new" type="password" autocomplete="new-password" required minlength="6"></label>
      <p class="err" id="pw-err"></p>
      <div class="row"><button class="primary" type="submit">Saqlash</button><button type="button" id="pw-rc">Yangi tiklash kodi olish</button><button type="button" data-close>Yopish</button></div>
    </form>`, m => {
    $("#pw",m).addEventListener("submit", async e => {
      e.preventDefault();
      try { await api("POST","/api/me/password",{ current:$("#pw-cur",m).value, password:$("#pw-new",m).value }); closeModal(); toast("Parol o'zgartirildi"); }
      catch(err){ $("#pw-err",m).textContent = err.message; }
    });
    $("#pw-rc",m).addEventListener("click", async () => {
      const cur = $("#pw-cur",m).value;
      if (!cur){ $("#pw-err",m).textContent = "Yangi kod olish uchun hozirgi parolni kiriting."; $("#pw-cur",m).focus(); return; }
      try { const r = await api("POST","/api/me/recovery",{ password:cur }); recoveryDialog(r.recoveryCode); }
      catch(err){ $("#pw-err",m).textContent = err.message; }
    });
  });
}
function adminDialog(){
  modal(`<h3>Foydalanuvchilar</h3>
    <input id="ad-q" type="search" placeholder="Ism yoki login bo'yicha qidirish" autocomplete="off">
    <p class="small muted" id="ad-info">Yuklanmoqda…</p>
    <div class="tw" style="max-height:55vh;overflow:auto" id="ad-list"></div>
    <div class="row"><button data-close>Yopish</button></div>`, m => {
    let users = [], t;
    const draw = () => { $("#ad-list",m).innerHTML = users.length ? `<table><thead><tr><th>Ism</th><th>Login</th><th>Guruh</th><th>Sana</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.name)}</td><td><b>${esc(u.username)}</b></td><td>${u.groups}</td><td class="small" style="white-space:nowrap">${new Date(u.createdAt).toLocaleDateString("uz-UZ",{day:"2-digit",month:"2-digit",year:"2-digit"})}</td><td>${u.isAdmin?`<span class="small muted">admin</span>`:`<button class="small" style="white-space:nowrap" data-ad-reset="${u.id}" title="Parolni tiklash">Tiklash</button>`}</td></tr>`).join("")}</tbody></table>` : `<p class="muted" style="padding:12px">Topilmadi.</p>`; };
    const load = async () => { try { const r = await api("GET","/api/admin/users?q="+encodeURIComponent($("#ad-q",m).value.trim())); users = r.users; $("#ad-info",m).textContent = `Jami ro'yxatdan o'tganlar: ${r.total}. Ko'rsatilgan: ${users.length}.`; draw(); } catch(err){ $("#ad-info",m).textContent = err.message; } };
    $("#ad-q",m).addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
    $("#ad-list",m).addEventListener("click", async e => {
      const b = e.target.closest("[data-ad-reset]"); if (!b) return;
      const u = users.find(x=>x.id===+b.dataset.adReset);
      if (!confirm(`${u.name} (${u.username}) uchun yangi parol yaratilsinmi? Eski parol ishlamay qoladi.`)) return;
      try { const r = await api("POST",`/api/admin/users/${u.id}/reset-password`); tempPasswordDialog(u, r.password); } catch(err){ toast(err.message); }
    });
    load();
  });
}
function tempPasswordDialog(u, pw){
  modal(`<h3>Yangi parol</h3><p>${esc(u.name)} endi shu ma'lumotlar bilan kiradi. Ularni o'ziga yuboring, kirgach parolni o'zgartirishni ayting (ismi ustiga bosib).</p>
    <p>Login: <b>${esc(u.username)}</b></p><div class="code recovery-code">${esc(pw)}</div>
    <div class="row"><button id="np-copy">Nusxalash</button><button class="primary" data-close>Yopish</button></div>`, m => $("#np-copy",m).addEventListener("click", () => copy(`Login: ${u.username}\nParol: ${pw}`)));
}
async function loadMembers(){
  if (!S.data?.role.owner) return;
  try { S.members = (await api("GET",`/api/groups/${S.code}/members`)).members; } catch(e){ toast(e.message); S.members = []; }
  const box = $("#members"); if (box) box.innerHTML = membersHTML();
}
function membersHTML(){
  if (!S.members) return `<p class="muted">Yuklanmoqda…</p>`;
  if (!S.members.length) return `<p class="muted">A'zolar yo'q.</p>`;
  return `<div class="tw"><table><thead><tr><th>Ism</th><th>Login</th><th></th></tr></thead><tbody>${S.members.map(u=>`<tr><td>${esc(u.name)}</td><td><b>${esc(u.username)}</b></td><td>${u.canReset?`<button class="small" data-resetpw="${u.id}">Parolni tiklash</button>`:""}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------- home ---------- */
function homeHTML(){
  const gs = S.groups;
  return `
  <section class="hero">
    <div class="stack">
      <span class="eyebrow">Kitob va fanlar bo'yicha testlar</span>
      <h1>Guruh yarating, savollarni kiriting, sheriklaringiz bilan birga yeching</h1>
      <p class="muted">Har bir bo'lim uchun alohida test va barcha mavzulardan aralash test. Javob darhol tekshiriladi, natijalar saqlanadi.</p>
      <div class="row"><button class="primary" data-act="new-group">Yangi guruh yaratish</button><button data-act="join">Kod bilan kirish</button></div>
    </div>
    ${sheetDemo()}
  </section>
  <section class="stack">
    <h2>Mening guruhlarim</h2>
    ${gs===null ? `<p class="muted">Yuklanmoqda…</p>` : gs.length ? `<div class="glist">${gs.map(g=>`<a class="gcard" href="/g/${esc(g.code)}" data-link style="text-decoration:none;color:inherit">
      <div class="spread"><span class="code">${esc(g.code)}</span>${g.mine?`<span class="chip">Egasi: siz</span>`:""}</div>
      <h3>${esc(g.name)}</h3>
      <span class="small muted">${g.book?esc(g.book)+" · ":""}${g.sections} bo'lim · ${g.questions} savol · ${g.members} a'zo</span></a>`).join("")}</div>`
      : `<div class="empty">Hali guruh yo'q. Yangi guruh yarating yoki sherigingiz yuborgan havola yoki kod bilan kiring.</div>`}
  </section>`;
}

/* ---------- group ---------- */
function groupHTML(){
  if (S.groupError) return `<div class="panel"><h2>Guruh ochilmadi</h2><p class="muted">${esc(S.groupError)}</p><div><a class="btn" href="/" data-link>Bosh sahifa</a></div></div>`;
  if (!S.data) return `<div class="panel"><p class="muted">Guruh yuklanmoqda…</p></div>`;
  const g = S.data.group;
  const tabs = [["tests","Testlar"],["questions","Savollar"]];
  if (canEdit()) tabs.push(["import","Excel / Word"]);
  tabs.push(["results","Natijalar"],["settings","Sozlamalar"]);
  return `
  <section class="stack">
    <a class="ghost small btn" href="/" data-link style="align-self:flex-start;text-decoration:none">← Guruhlarim</a>
    <div class="gbanner">
      <div class="spread">
        <div class="stack" style="gap:4px;min-width:0"><span class="eyebrow">${esc(g.book || "Guruh")}</span><h1>${esc(g.name)}</h1></div>
        <div class="row"><span class="code" title="Guruh kodi">${esc(g.code)}</span><button data-act="share">Havolani nusxalash</button></div>
      </div>
      <div class="row stats"><span class="stat">${sections().length} ta bo'lim</span><span class="stat">${questions().length} ta savol</span><span class="stat">Egasi: ${esc(g.ownerName)}</span></div>
    </div>
  </section>
  <nav class="tabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${S.tab===k}" data-tab="${k}">${l}</button>`).join("")}</nav>
  <section class="stack">${tabHTML()}</section>`;
}
function tabHTML(){
  switch(S.tab){
    case "tests": return testsTab();
    case "questions": return questionsTab();
    case "import": return canEdit() ? importTab() : "";
    case "results": return resultsTab();
    case "settings": return settingsTab();
  }
  return "";
}

function bestBySection(){
  const out = {};
  for (const r of (S.results?.mine || [])) if (r.mode==="section"){ const p = pct(r.right, r.total); out[r.sectionId] = Math.max(out[r.sectionId] ?? 0, p); }
  return out;
}
function testsTab(){
  const bySec = qBySec(); const total = questions().length;
  const mis = S.data.mistakes.length;
  const best = bestBySection();
  const secs = sections();
  return `
  <div class="mix">
    <div class="stack" style="gap:4px"><span class="eyebrow" style="color:inherit;opacity:.7">Barcha mavzulardan</span><h2>Aralash test</h2><p class="muted small">${total} ta savoldan tasodifiy tanlanadi</p></div>
    <button class="primary" data-start="mixed" ${total?"":"disabled"}>Boshlash</button>
  </div>
  ${mis ? `<div class="panel" style="flex-direction:row;justify-content:space-between;align-items:center;flex-wrap:wrap"><div><h3>Xatolar ustida ishlash</h3><p class="small muted">Siz xato qilgan ${mis} ta savol. To'g'ri yechganingizda ro'yxatdan chiqadi.</p></div><button data-start="mistakes">Qayta yechish</button></div>` : ""}
  <div class="spread"><h2>Bo'limlar bo'yicha</h2>${canEdit()?`<button data-act="add-sections">+ Bo'lim qo'shish</button>`:""}</div>
  ${secs.length ? `<div class="sec-grid">${secs.map((s,i)=>{ const n=(bySec[s.id]||[]).length; const b=best[s.id];
    return `<div class="sec" style="--h:${[243,262,199,160,330,25][i%6]}"><span class="num">${String(i+1).padStart(2,"0")}</span>
      <div class="t"><b>${esc(s.title)}</b><span class="small muted">${n} ta savol${b!=null?` · eng yaxshi natijangiz ${b}%`:""}</span><div class="bar"><i style="width:${b??0}%"></i></div></div>
      <div class="act row">${canEdit()?`<button class="ghost" data-addq="${s.id}">+ Savol</button>`:""}<button class="primary" data-start="section" data-sid="${s.id}" ${n?"":"disabled"}>Test</button></div></div>`;}).join("")}</div>`
    : `<div class="empty">${canEdit()?"Bo'limlar yo'q. Kitobingiz bo'limlarini qo'shing: 30 ta bo'lim nomini bir yo'la kiritishingiz mumkin.":"Bu guruhda hali bo'lim yo'q."}</div>`}`;
}

/* ---------- questions tab ---------- */
function questionsTab(){
  const secs = sections();
  let list = questions().slice();
  if (S.filterSec !== "all") list = list.filter(q=>q.sectionId===+S.filterSec);
  const sq = norm(S.search); if (sq) list = list.filter(q=>norm(q.text).includes(sq));
  const ed = canEdit();
  return `
  ${ed ? `<div class="panel" id="qform">${qFormHTML()}</div>` : `<div class="notice info">Savollarni guruh egasi qo'shadi. Siz testlarni yechishingiz mumkin.</div>`}
  <div class="spread"><h2>Savollar ro'yxati</h2><span class="small muted">${list.length} ta</span></div>
  <div class="grid2">
    <select id="fsec" aria-label="Bo'lim bo'yicha saralash"><option value="all">Barcha bo'limlar</option>${secs.map((s,i)=>`<option value="${s.id}" ${String(S.filterSec)===String(s.id)?"selected":""}>${i+1}. ${esc(s.title)}</option>`).join("")}</select>
    <input id="fsearch" placeholder="Savol matni bo'yicha qidirish" value="${esc(S.search)}">
  </div>
  ${list.length ? `<div class="stack" style="gap:8px">${list.slice(0,300).map(q=>`<div class="qitem">
    <div class="spread"><span class="chip">${esc(secName(q.sectionId))}</span>${ed?`<div class="row" style="gap:2px"><button class="ghost small" data-editq="${q.id}">Tahrirlash</button><button class="ghost small danger" data-delq="${q.id}">O'chirish</button></div>`:""}</div>
    <b style="overflow-wrap:anywhere;white-space:pre-wrap">${esc(q.text)}</b>
    ${ed ? `<ol>${q.options.map((o,j)=>`<li class="${j===q.correct?"c":""}">${LETTERS[j]}) ${esc(o)}${j===q.correct?" ✓":""}</li>`).join("")}</ol>${q.explanation?`<span class="small muted">Izoh: ${esc(q.explanation)}</span>`:""}`
         : `<span class="small muted">${q.options.length} ta variant</span>`}
  </div>`).join("")}${list.length>300?`<p class="small muted">Birinchi 300 tasi ko'rsatildi. Qidiruvdan foydalaning.</p>`:""}</div>` : `<div class="empty">Savollar topilmadi.</div>`}`;
}
function qFormHTML(q){
  const secs = sections();
  q = q || { sectionId: S.filterSec!=="all" ? +S.filterSec : (S.lastSec || secs[0]?.id), text:"", options:["","","",""], correct:0, explanation:"" };
  if (!secs.length) return `<h3>Savol qo'shish</h3><p class="muted">Avval kamida bitta bo'lim qo'shing.</p><div><button data-act="add-sections">+ Bo'lim qo'shish</button></div>`;
  return `<div class="spread"><h3>${editing?"Savolni tahrirlash":"Bitta savol qo'shish"}</h3>${editing?`<button class="ghost small" data-act="cancel-edit">Bekor qilish</button>`:""}</div>
  <label class="f">Bo'lim<select id="qs">${secs.map((s,i)=>`<option value="${s.id}" ${q.sectionId===s.id?"selected":""}>${i+1}. ${esc(s.title)}</option>`).join("")}</select></label>
  <label class="f">Savol matni<textarea id="qq" rows="2">${esc(q.text)}</textarea></label>
  <div id="dupwarn"></div>
  <div class="stack" style="gap:8px" id="qopts">${q.options.map((o,j)=>optRow(j,o,j===q.correct)).join("")}</div>
  <div class="row"><button class="ghost small" data-act="add-opt">+ Variant</button><span class="small muted">To'g'ri javobni o'ng tomondagi doira bilan belgilang</span></div>
  <label class="f">Izoh (ixtiyoriy, xato qilganda ko'rsatiladi)<input id="qe" value="${esc(q.explanation||"")}"></label>
  <div class="row"><button class="primary" data-act="save-q">${editing?"Saqlash":"Savolni qo'shish"}</button></div>`;
}
function optRow(j,val,checked){ return `<div class="optrow"><span class="lt">${LETTERS[j]}</span><input data-opt="${j}" value="${esc(val)}" placeholder="${LETTERS[j]} variant"><input type="radio" name="qc" value="${j}" ${checked?"checked":""} aria-label="${LETTERS[j]} to'g'ri javob"></div>`; }
function findDup(text, exceptId){ const n = norm(text); if (!n) return null; return questions().find(q => norm(q.text)===n && q.id!==exceptId) || null; }
async function saveQuestion(){
  const opts = $$("[data-opt]").map(i=>i.value.trim());
  const cEl = $('input[name="qc"]:checked'); let c = cEl ? +cEl.value : -1;
  const filled = opts.map((o,i)=>({o,i})).filter(x=>x.o);
  if (c>=0 && !opts[c]) return toast("Belgilangan to'g'ri javob bo'sh. Uni to'ldiring.");
  const body = { sectionId: +$("#qs").value, text: $("#qq").value.trim(), options: filled.map(x=>x.o), correct: filled.findIndex(x=>x.i===c), explanation: $("#qe").value.trim() };
  const dup = findDup(body.text, editing); if (dup) return toast(`Rad etildi: bu savol allaqachon bor (${secName(dup.sectionId)}).`);
  const btn = $('[data-act="save-q"]'); btn.disabled = true;
  try {
    if (editing) await api("PUT", "/api/questions/"+editing, body); else await api("POST", `/api/groups/${S.code}/questions`, body);
    toast(editing ? "Saqlandi" : "Savol qo'shildi");
    S.lastSec = body.sectionId; editing = null;
    await loadGroup(); $("#qq")?.focus();
  } catch(e){ toast(e.message); btn.disabled = false; }
}

/* ---------- import ---------- */
function importTab(){
  const secs = sections();
  return `<div class="panel">
    <h3>Excel yoki Word fayldan savollar yuklash</h3>
    <div class="drop" id="drop">
      <p id="dropmsg"><b>Faylni shu yerga tashlang</b> yoki tanlang</p>
      <p class="small muted">.xlsx, .xls, .csv, .docx, .txt</p>
      <input type="file" id="file" accept=".xlsx,.xls,.csv,.docx,.txt" style="max-width:300px">
    </div>
    <div class="grid2">
      <label class="f">Bo'lim ko'rsatilmagan savollar uchun<select id="impsec">${secs.map((s,i)=>`<option value="${s.id}">${i+1}. ${esc(s.title)}</option>`).join("")}${secs.length?"":`<option value="">Avval bo'lim qo'shing</option>`}</select></label>
      <label class="toggle small"><input type="checkbox" id="firstok" ${store.get("firstok",true)?"checked":""}>Javob ko'rsatilmasa, birinchi variant to'g'ri hisoblansin (variantlar testda baribir aralashtiriladi)</label>
    </div>
    <details><summary class="small" style="cursor:pointer">Fayl formati</summary>
      <div class="stack" style="margin-top:10px">
        <p class="small"><b>Excel:</b> birinchi qator sarlavha bo'lishi mumkin. “Javob” ustuniga harf (A, B…), raqam (1, 2…) yoki to'g'ri variant matnini yozing. Excelda bir nechta varaq bo'lsa, varaq nomi bo'lim nomi sifatida olinadi.</p>
        <div class="tw"><table><tr><th>Bo'lim</th><th>Savol</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Javob</th><th>Izoh</th></tr><tr><td>Elektr toki</td><td>Tok kuchi birligi?</td><td>Volt</td><td>Amper</td><td>Om</td><td>Vatt</td><td>B</td><td></td></tr></table></div>
        <div><button data-act="template">Excel shablonini yuklab olish</button></div>
        <p class="small"><b>Word yoki matn:</b> savol raqam bilan, variantlar harf bilan yoziladi. To'g'ri javob oldiga <span class="mono">*</span> qo'ying yoki “Javob: B” qatorini yozing. “Bo'lim: …” qatori keyingi savollarning bo'limini belgilaydi.</p>
<pre class="fmt">Bo'lim: Elektr toki
1. Tok kuchi birligi nima?
A) Volt
*B) Amper
C) Om
D) Vatt

2. Kuchlanish qaysi asbob bilan o'lchanadi?
A) Ampermetr
B) Voltmetr
C) Ommetr
Javob: B</pre>
      </div>
    </details>
  </div>
  ${S.importRows ? importPreview(S.importRows) : ""}`;
}
function importPreview(rows){
  const ok = rows.filter(r=>r.status==="new").length;
  const dup = rows.filter(r=>r.status.startsWith("dup")).length;
  const bad = rows.filter(r=>r.status==="error").length;
  const label = r => r.status==="new" ? `<span class="chip ok">Yangi</span>` : r.status==="dup-db" ? `<span class="chip bad">Takror: bazada bor</span>` : r.status==="dup-file" ? `<span class="chip bad">Takror: faylda 2 marta</span>` : `<span class="chip warn">${esc(r.err)}</span>`;
  return `<div class="panel">
    <div class="spread"><h3>Tekshiruv natijasi</h3><div class="row small"><span class="chip ok">${ok} yangi</span><span class="chip bad">${dup} takror (rad etiladi)</span><span class="chip warn">${bad} xato</span></div></div>
    <div class="tw" style="max-height:420px;overflow:auto"><table><thead><tr><th>#</th><th>Savol</th><th>Bo'lim</th><th>To'g'ri javob</th><th>Holat</th></tr></thead><tbody>
    ${rows.map((r,i)=>`<tr><td class="n">${i+1}</td><td style="min-width:200px;white-space:pre-wrap">${esc(r.text)}</td><td>${esc(r.secLabel||"")}</td><td>${r.options&&r.correct>=0?esc(r.options[r.correct]):"—"}</td><td>${label(r)}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="row"><button class="primary" data-act="do-import" ${ok?"":"disabled"}>${ok} ta yangi savolni qo'shish</button><button data-act="clear-import">Bekor qilish</button></div>
  </div>`;
}
function answerIndex(ans, opts){
  if (ans==null) return -1;
  const a = String(ans).trim(); if (!a) return -1;
  const L = a.toUpperCase().replace(/[\)\.\s]/g,"");
  const map = { "A":0,"B":1,"C":2,"D":3,"E":4,"F":5,"А":0,"Б":1,"В":2,"Г":3,"Д":4 };
  if (L.length===1 && L in map) return map[L] < opts.length ? map[L] : -1;
  if (/^\d$/.test(L)){ const n=+L-1; return n>=0&&n<opts.length?n:-1; }
  const na = norm(a); return opts.findIndex(o=>norm(o)===na);
}
function parseSheet(aoa){
  aoa = aoa.filter(r => r && r.some(c => String(c??"").trim()));
  if (!aoa.length) return [];
  let cols = { sec:0, q:1, opts:[2,3,4,5], ans:6, exp:7 };
  const head = aoa[0].map(c=>norm(c));
  if (head.some(h=>/savol|question|вопрос/.test(h))){
    const find = re => head.findIndex(h=>re.test(h));
    const q = find(/savol|question|вопрос/);
    const sec = find(/bo.?lim|mavzu|bob|раздел|тема|section/);
    const ans = find(/javob|answer|ответ|to.?g.?ri/);
    const exp = find(/izoh|explan|поясн/);
    const opts = head.map((h,i)=>({h,i})).filter(x=>x.i!==q&&x.i!==sec&&x.i!==ans&&x.i!==exp && /^(variant|[a-f]$|[абвгд]$|option)/.test(x.h)).map(x=>x.i);
    cols = { sec, q, opts: opts.length?opts:[q+1,q+2,q+3,q+4], ans, exp };
    aoa = aoa.slice(1);
  } else if (aoa.every(r => r.length <= 6)) {
    cols = { sec:-1, q:0, opts:[1,2,3,4], ans:5, exp:-1 };
  }
  const cell = (r,i) => i>=0 ? String(r[i]??"").trim() : "";
  return aoa.map(r => ({ sec: cell(r,cols.sec), q: cell(r,cols.q), o: cols.opts.map(i=>cell(r,i)).filter(Boolean), ansRaw: cell(r,cols.ans), e: cell(r,cols.exp) }));
}
function parseText(text){
  const lines = text.split(/\r?\n/).map(l=>l.replace(/ /g," ").trim());
  const out = []; let cur = null; let sec = "";
  const reSec = /^(bo['‘’`ʻ]?lim|mavzu|bob|раздел|тема)\s*[:\-–]\s*(.+)$/i;
  const reOpt = /^([*+#])?\s*([A-Fa-fАБВГДабвгд])\s*[\)\.]\s*([*+#])?\s*(.+)$/;
  const reAns = /^(javob|to['‘’`ʻ]?g['‘’`ʻ]?ri\s+javob|answer|ответ)\s*[:\-–]\s*(.+)$/i;
  const reQ = /^(\d+)\s*[\.\)]\s*(.+)$/;
  const push = () => { if (cur && cur.q) out.push(cur); cur = null; };
  for (const l of lines){
    if (!l) continue;
    let m;
    if ((m = l.match(reSec))){ push(); sec = m[2].trim(); continue; }
    if ((m = l.match(reAns)) && cur){ cur.ansRaw = m[2].trim(); continue; }
    if (cur && (m = l.match(reOpt))){ if (m[1]||m[3]) cur.cIdx = cur.o.length; cur.o.push(m[4].trim()); continue; }
    if ((m = l.match(reQ))){ push(); cur = { sec, q:m[2].trim(), o:[], ansRaw:"", e:"" }; continue; }
    if (cur && cur.o.length===0){ cur.q += "\n"+l; continue; }
    push(); cur = { sec, q:l, o:[], ansRaw:"", e:"" };
  }
  push();
  return out;
}
function validateRows(raw){
  const firstOk = $("#firstok")?.checked;
  const defSec = +($("#impsec")?.value || 0);
  const secs = sections();
  const existing = new Set(questions().map(q=>norm(q.text)));
  const seen = new Set();
  return raw.map(r => {
    const row = { text:r.q, options:r.o, explanation:r.e||"", status:"new", correct:-1 };
    row.correct = r.cIdx!=null ? r.cIdx : answerIndex(r.ansRaw, r.o);
    if (row.correct<0 && !r.ansRaw && firstOk && r.o.length>=2) row.correct = 0;
    const found = r.sec ? secs.find(s=>norm(s.title)===norm(r.sec)) : null;
    if (found){ row.sectionId = found.id; row.secLabel = secName(found.id); }
    else if (r.sec){ row.sectionName = r.sec; row.secLabel = r.sec+" (yangi bo'lim)"; }
    else if (defSec){ row.sectionId = defSec; row.secLabel = secName(defSec); }
    else { row.status="error"; row.err="Bo'lim yo'q"; }
    const n = norm(row.text);
    if (row.status==="new"){
      if (!n) { row.status="error"; row.err="Savol matni yo'q"; }
      else if (row.options.length<2) { row.status="error"; row.err="Variantlar kam"; }
      else if (row.options.length>6) { row.status="error"; row.err="6 tadan ko'p variant"; }
      else if (row.correct<0) { row.status="error"; row.err="Javob topilmadi"; }
      else if (new Set(row.options.map(norm)).size !== row.options.length) { row.status="error"; row.err="Bir xil variantlar"; }
      else if (existing.has(n)) row.status="dup-db";
      else if (seen.has(n)) row.status="dup-file";
    }
    if (n) seen.add(n);
    return row;
  });
}
async function handleFile(file){
  if (!file) return;
  const name = file.name.toLowerCase();
  const msg = t => { const d=$("#dropmsg"); if (d) d.innerHTML = `<b>${esc(t)}</b>`; };
  try {
    let raw;
    if (/\.(xlsx|xls|csv)$/.test(name)){
      msg("Excel o'qilmoqda…"); await loadScript(XLSX_SRC);
      const wb = XLSX.read(await file.arrayBuffer(), { type:"array" });
      raw = [];
      for (const sn of wb.SheetNames){
        const part = parseSheet(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header:1, raw:false, defval:"" }));
        if (wb.SheetNames.length>1) part.forEach(r=>{ if(!r.sec) r.sec = sn; });
        raw.push(...part);
      }
    } else if (/\.docx$/.test(name)){
      msg("Word o'qilmoqda…"); await loadScript(MAMMOTH_SRC);
      raw = parseText((await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value);
    } else if (/\.txt$/.test(name)){
      raw = parseText(await file.text());
    } else { toast("Bu fayl turi qo'llanmaydi. .xlsx, .docx yoki .txt yuboring."); return; }
    if (!raw.length){ toast("Faylda savol topilmadi. Formatni tekshiring."); S.importRows=null; render(); return; }
    S.importRows = validateRows(raw); render();
  } catch { toast("Faylni o'qib bo'lmadi: fayl buzilgan yoki format boshqacha. Eski .doc faylni .docx qilib saqlang."); render(); }
}
async function doImport(){
  const items = S.importRows.filter(r=>r.status==="new").map(r=>({ text:r.text, options:r.options, correct:r.correct, explanation:r.explanation, sectionId:r.sectionId, sectionName:r.sectionName }));
  const btn = $('[data-act="do-import"]'); btn.disabled = true; btn.textContent = "Yuklanmoqda…";
  try {
    const rep = await api("POST", `/api/groups/${S.code}/questions/bulk`, { items });
    S.importRows = null;
    const rejected = rep.duplicates.length + rep.errors.length;
    toast(`${rep.added} ta savol qo'shildi${rejected?`, ${rejected} tasi rad etildi`:""}.`);
    S.tab = "tests"; await loadGroup();
  } catch(e){ toast(e.message); btn.disabled = false; }
}
async function downloadTemplate(){
  try {
    await loadScript(XLSX_SRC);
    const s0 = sections()[0]?.title || "1-bo'lim";
    const aoa = [["Bo'lim","Savol","A","B","C","D","Javob","Izoh"],
      [s0,"Tok kuchi birligi nima?","Volt","Amper","Om","Vatt","B","Amper tok kuchining birligi"],
      [s0,"Kuchlanish qaysi asbob bilan o'lchanadi?","Ampermetr","Voltmetr","Ommetr","Vattmetr","B",""]];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"]=[{wch:18},{wch:40},{wch:16},{wch:16},{wch:16},{wch:16},{wch:8},{wch:30}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Savollar");
    downloadBlob("test-shablon.xlsx", XLSX.write(wb, { type:"array", bookType:"xlsx" }), XLSX_TYPE);
  } catch { toast("Shablonni tayyorlab bo'lmadi."); }
}

/* ---------- results tab ---------- */
function modeLabel(r){ return r.mode==="mixed" ? "Aralash test" : r.mode==="mistakes" ? "Xatolar ustida" : secName(r.sectionId); }
function resultsTab(){
  const R = S.results;
  if (!R) return `<p class="muted">Natijalar yuklanmoqda…</p>`;
  const hard = questions().filter(q=>q.attempts>=3 && q.wrong>0).sort((a,b)=>b.wrong/b.attempts - a.wrong/a.attempts).slice(0,10);
  return `
  <div class="spread"><h2>Guruh reytingi</h2>${R.recent.length?`<button data-act="export">Excelga yuklab olish</button>`:""}</div>
  ${R.board.length ? `<div class="tw"><table><thead><tr><th>#</th><th>Ishtirokchi</th><th>Testlar</th><th>O'rtacha</th><th>Eng yaxshi</th><th>Oxirgi marta</th></tr></thead><tbody>
    ${R.board.map((b,i)=>`<tr${b.me?' style="background:var(--tint)"':""}><td class="n">${i+1}</td><td>${esc(b.name)}${b.me?" (siz)":""}</td><td class="n">${b.tests}</td><td class="n">${pct(b.right_sum,b.total_sum)}%</td><td class="n">${b.best}%</td><td class="n">${fmtDate(b.last_at)}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty">Reyting hozircha bo'sh. Kimdir test yechib tugatganda bu yerda ko'rinadi.</div>`}
  ${hard.length ? `<h2>Eng qiyin savollar</h2><p class="small muted">Guruh a'zolari eng ko'p xato qilgan savollar. Shu mavzularni qayta tushuntirish foydali.</p>
  <div class="tw hard"><table><thead><tr><th>Savol</th><th>Bo'lim</th><th>Xato</th></tr></thead><tbody>
    ${hard.map(q=>`<tr><td>${esc(q.text)}</td><td>${esc(secName(q.sectionId))}</td><td class="n"><span class="meter"><i style="width:${pct(q.wrong,q.attempts)}%"></i></span>${pct(q.wrong,q.attempts)}% (${q.wrong}/${q.attempts})</td></tr>`).join("")}
  </tbody></table></div>` : ""}
  <h2>Mening natijalarim</h2>
  ${R.mine.length ? `<div class="tw"><table><thead><tr><th>Sana</th><th>Test</th><th>Natija</th><th>Baho</th><th>Vaqt</th></tr></thead><tbody>
    ${R.mine.slice(0,100).map(r=>`<tr><td class="n">${fmtDate(r.at)}</td><td>${esc(modeLabel(r))}</td><td class="n">${r.right}/${r.total} · ${pct(r.right,r.total)}%</td><td class="n">${grade(pct(r.right,r.total))}</td><td class="n">${fmtTime(r.seconds||0)}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty">Siz hali bu guruhda test yechmadingiz.</div>`}
  <p class="small muted">Baho: 86% va undan yuqori 5, 71–85% 4, 56–70% 3, undan past 2.</p>`;
}
async function exportResults(){
  try {
    await loadScript(XLSX_SRC);
    const aoa = [["Sana","Ishtirokchi","Test","To'g'ri","Jami","Foiz","Baho","Vaqt (daqiqa:soniya)"]];
    for (const r of S.results.recent){ const p = pct(r.right,r.total); aoa.push([new Date(r.at).toLocaleString("uz-UZ"), r.name, modeLabel(r), r.right, r.total, p, grade(p), fmtTime(r.seconds||0)]); }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Natijalar");
    downloadBlob(`natijalar-${S.code}.xlsx`, XLSX.write(wb,{type:"array",bookType:"xlsx"}), XLSX_TYPE);
  } catch { toast("Faylni tayyorlab bo'lmadi."); }
}

/* ---------- settings ---------- */
function settingsTab(){
  const g = S.data.group, own = S.data.role.owner, ed = canEdit();
  return `
  <div class="panel">
    <h3>Ulashish</h3>
    <p class="small muted">Sheriklaringizga havolani yuboring. Ular ro'yxatdan o'tib, darhol testlarni yecha oladi. Kod bilan ham kirish mumkin.</p>
    <input readonly value="${esc(shareLink())}" id="sharelink">
    <div class="row"><span class="code">${esc(g.code)}</span><button data-act="share">Havolani nusxalash</button><button data-act="copy-code">Kodni nusxalash</button></div>
  </div>
  ${own ? `<div class="panel">
    <h3>Guruh ma'lumotlari</h3>
    <label class="f">Guruh nomi<input id="gname" value="${esc(g.name)}"></label>
    <label class="f">Kitob yoki fan<input id="gbook" value="${esc(g.book||"")}"></label>
    <label class="toggle"><input type="checkbox" id="gmce" ${g.membersCanEdit?"checked":""}>A'zolar ham savol va bo'lim qo'sha olsin</label>
    <div><button class="primary" data-act="save-group">Saqlash</button></div>
  </div>` : ""}
  ${ed ? `<div class="panel">
    <h3>Bo'limlar</h3>
    <div class="stack" style="gap:8px">${sections().map((s,i)=>`<div class="optrow" style="grid-template-columns:auto 1fr auto"><span class="lt">${i+1}</span><input data-secname="${s.id}" value="${esc(s.title)}"><div class="secbtns"><button class="ghost small" data-move="up" data-sid="${s.id}" ${i===0?"disabled":""} aria-label="Yuqoriga">↑</button><button class="ghost small" data-move="down" data-sid="${s.id}" ${i===sections().length-1?"disabled":""} aria-label="Pastga">↓</button><button class="ghost small danger" data-delsec="${s.id}">O'chirish</button></div></div>`).join("") || `<p class="muted">Bo'limlar yo'q.</p>`}</div>
    <div class="row"><button data-act="add-sections">+ Bo'lim qo'shish</button>${sections().length?`<button data-act="save-secnames">Nomlarni saqlash</button>`:""}</div>
  </div>` : ""}
  ${own ? `<div class="panel">
    <h3>A'zolar</h3>
    <p class="small muted">A'zo loginini yoki parolini unutsa, shu yerdan ko'rasiz va parolini tiklaysiz. Yangi vaqtinchalik parol faqat sizga bir marta ko'rsatiladi.</p>
    <div id="members">${membersHTML()}</div>
  </div>` : ""}
  <div class="panel">
    <h3>Xavfli amallar</h3>
    <div class="row">${own ? `<button class="danger" data-act="del-group">Guruhni butunlay o'chirish</button>` : `<button class="danger" data-act="leave">Guruhdan chiqish</button>`}</div>
  </div>`;
}

/* ---------- quiz ---------- */
function startQuizDialog(mode, sid){
  let pool;
  if (mode==="mixed") pool = questions().slice();
  else if (mode==="section") pool = questions().filter(q=>q.sectionId===sid);
  else { const ids = new Set(S.data.mistakes.map(m=>m.id)); pool = questions().filter(q=>ids.has(q.id)); }
  if (!pool.length) return toast("Bu yerda savol yo'q.");
  const counts = [10,20,30,50].filter(n=>n<pool.length); counts.push(pool.length);
  let count = mode==="mixed" ? (counts.find(n=>n>=30) || pool.length) : pool.length;
  let exam = false;
  const title = mode==="mixed" ? "Aralash test" : mode==="mistakes" ? "Xatolar ustida ishlash" : secName(sid);
  modal(`<h3>${esc(title)}</h3>
    <div class="stack" style="gap:6px"><span class="eyebrow">Savollar soni</span><div class="seg" id="cnt">${counts.map(n=>`<button data-n="${n}" aria-pressed="${n===count}">${n===pool.length?`Hammasi (${n})`:n}</button>`).join("")}</div></div>
    <div class="stack" style="gap:6px"><span class="eyebrow">Rejim</span><div class="seg" id="md"><button data-m="0" aria-pressed="true">Mashq: javob darhol ko'rinadi</button><button data-m="1" aria-pressed="false">Imtihon: natija oxirida</button></div></div>
    <div class="row"><button class="primary" id="go">Boshlash</button><button data-close>Bekor qilish</button></div>`, m => {
      $("#cnt",m).addEventListener("click", e => { const b=e.target.closest("[data-n]"); if(!b) return; count=+b.dataset.n; $$("#cnt button",m).forEach(x=>x.setAttribute("aria-pressed", x===b)); });
      $("#md",m).addEventListener("click", e => { const b=e.target.closest("[data-m]"); if(!b) return; exam=b.dataset.m==="1"; $$("#md button",m).forEach(x=>x.setAttribute("aria-pressed", x===b)); });
      $("#go",m).addEventListener("click", () => { closeModal(); startQuiz(mode, sid, shuffle(pool).slice(0,count), exam, title); });
    });
}
function startQuiz(mode, sid, qs, exam, title){
  S.quiz = { mode, sid, exam, title, i:0, start:Date.now(), items: qs.map(q => ({ q, order: shuffle(q.options.map((_,i)=>i)), pick:null })) };
  S.view = "quiz"; render(); startTick(); window.scrollTo(0,0);
}
let tick;
function startTick(){ clearInterval(tick); tick = setInterval(()=>{ const t=$("#qtime"); if (t && S.quiz) t.textContent = fmtTime(Math.floor((Date.now()-S.quiz.start)/1000)); }, 1000); }
const isRight = x => x.pick!==null && x.order[x.pick]===x.q.correct;
function quizHTML(){
  const Q = S.quiz; const it = Q.items[Q.i]; const n = Q.items.length;
  const answered = it.pick!==null;
  const right = Q.items.filter(isRight).length;
  const wrong = Q.items.filter(x=>x.pick!==null && !isRight(x)).length;
  const ok = isRight(it);
  const fb = answered && !Q.exam;
  return `
  <div class="qhead"><button class="ghost small" data-act="quit">← Chiqish</button><span class="small muted" style="overflow-wrap:anywhere">${esc(Q.title)}</span>
    <div class="score">${Q.exam?"":`<span class="chip ok">✓ ${right}</span><span class="chip bad">✗ ${wrong}</span>`}<span class="chip" id="qtime">${fmtTime(Math.floor((Date.now()-Q.start)/1000))}</span></div></div>
  <div class="prog" aria-hidden="true"><i style="width:${(Q.i+(answered?1:0))*100/n}%"></i></div>
  <div class="qcard">
    <div class="spread"><span class="eyebrow">Savol ${Q.i+1} / ${n}</span>${Q.mode!=="section"?`<span class="chip">${esc(secName(it.q.sectionId))}</span>`:""}</div>
    <div class="qtext">${esc(it.q.text)}</div>
    <div class="opts">${it.order.map((oi,j)=>{
      let cls = "";
      if (fb){ if (oi===it.q.correct) cls="ok"; else if (j===it.pick) cls="bad"; }
      else if (answered && j===it.pick) cls="picked";
      return `<button class="opt ${cls}" data-pick="${j}" ${answered?"disabled":""}><span class="lt">${LETTERS[j]}</span><span class="tx">${esc(it.q.options[oi])}</span></button>`; }).join("")}</div>
    ${fb ? `<div class="verdict ${ok?"ok":"bad"}" role="status">${ok?"To'g'ri!":`Noto'g'ri. To'g'ri javob: ${LETTERS[it.order.indexOf(it.q.correct)]}) ${esc(it.q.options[it.q.correct])}`}${it.q.explanation?`<p>${esc(it.q.explanation)}</p>`:""}</div>` : ""}
    <div class="spread">
      <span class="small muted">Klaviatura: A–${LETTERS[it.order.length-1]} yoki 1–${it.order.length}, keyingisi Enter</span>
      ${answered ? `<button class="primary" data-act="next" id="nextbtn">${Q.i+1<n?"Keyingi savol →":"Natijani ko'rish"}</button>` : (Q.i+1<n ? `<button class="ghost" data-act="skip">Keyinroq javob beraman</button>` : "")}
    </div>
  </div>`;
}
function pick(j){ const it = S.quiz.items[S.quiz.i]; if (it.pick!==null) return; it.pick = j; render(); $("#nextbtn")?.focus(); }
function next(){ const Q = S.quiz; if (Q.i+1 < Q.items.length){ Q.i++; render(); } else finish(); }
function skip(){ const Q=S.quiz; const it=Q.items.splice(Q.i,1)[0]; Q.items.push(it); render(); }
async function finish(){
  clearInterval(tick);
  const Q = S.quiz;
  const seconds = Math.floor((Date.now()-Q.start)/1000);
  Q.result = { total: Q.items.length, right: Q.items.filter(isRight).length, seconds };
  Q.saved = "pending"; S.view = "done"; render(); window.scrollTo(0,0);
  const answers = Q.items.map(x => ({ questionId: x.q.id, choice: x.pick===null ? null : x.order[x.pick] }));
  try {
    await api("POST", `/api/groups/${S.code}/results`, { mode:Q.mode, sectionId:Q.sid, seconds, answers });
    Q.saved = "ok";
    S.results = null;
    api("GET", "/api/groups/"+S.code).then(d => { S.data = d; }).catch(()=>{});
  } catch(e){ Q.saved = "fail"; Q.saveErr = e.message; }
  if (S.view==="done") render();
}
function doneHTML(){
  const Q = S.quiz; const r = Q.result; const p = pct(r.right,r.total); const gr = grade(p);
  const wrong = Q.items.filter(x=>!isRight(x));
  const col = gr>=4 ? "var(--ok)" : gr===3 ? "var(--warn)" : "var(--bad)";
  return `
  <div class="panel" style="gap:18px">
    <span class="eyebrow">${esc(Q.title)}</span>
    <div class="row" style="gap:20px">
      <div class="grade" style="color:${col}" aria-label="Baho ${gr}">${gr}</div>
      <div class="ring" style="--p:${p};--c:${col}"><span class="big">${p}%</span></div>
      <div class="stack" style="gap:4px"><span class="muted">${r.right} / ${r.total} to'g'ri · ${fmtTime(r.seconds)}</span></div>
    </div>
    <p class="small ${Q.saved==="fail"?"err":"muted"}">${Q.saved==="ok" ? "Natija saqlandi va guruh reytingiga qo'shildi." : Q.saved==="pending" ? "Natija saqlanmoqda…" : `Natija saqlanmadi: ${esc(Q.saveErr)} <button class="ghost small" data-act="resave">Qayta urinish</button>`}</p>
    <div class="row">
      <button class="primary" data-act="retry">Qayta yechish</button>
      ${wrong.length?`<button data-act="retry-wrong">Faqat xatolarni qayta yechish (${wrong.length})</button>`:""}
      <button data-act="back-group">Guruhga qaytish</button>
    </div>
  </div>
  ${wrong.length ? `<h2>Xatolar tahlili</h2><div class="stack" style="gap:8px">${wrong.map(x=>{ const ch = x.pick===null?null:x.q.options[x.order[x.pick]];
    return `<div class="qitem"><b style="overflow-wrap:anywhere;white-space:pre-wrap">${esc(x.q.text)}</b>
    ${ch!==null?`<span class="small" style="color:var(--bad)">Sizning javobingiz: ${esc(ch)}</span>`:`<span class="small muted">Javob berilmagan</span>`}
    <span class="small" style="color:var(--ok);font-weight:600">To'g'ri javob: ${esc(x.q.options[x.q.correct])}</span>${x.q.explanation?`<span class="small muted">${esc(x.q.explanation)}</span>`:""}</div>`; }).join("")}</div>` : `<div class="empty">Barcha savollarga to'g'ri javob berdingiz. Barakalla!</div>`}`;
}

/* ---------- dialogs ---------- */
const splitTitles = v => v.split(/\n/).map(s=>s.replace(/^\s*\d+\s*[\.\)\-]\s*/,"").trim()).filter(Boolean);
function newGroupDialog(){
  modal(`<h3>Yangi guruh</h3>
    <label class="f">Guruh nomi<input id="ng-name" placeholder="Masalan: 10-B sinf"></label>
    <label class="f">Kitob yoki fan<input id="ng-book" placeholder="Masalan: Matematika"></label>
    <label class="f">Bo'limlar (har qatorga bittadan, keyin ham qo'shish mumkin)<textarea id="ng-secs" rows="5" placeholder="Natural sonlar&#10;Kasrlar&#10;Tenglamalar"></textarea></label>
    <label class="f">Yoki faqat bo'limlar soni<input id="ng-count" type="number" min="0" max="300" placeholder="Masalan: 30"></label>
    <label class="toggle small"><input type="checkbox" id="ng-mce">A'zolar ham savol qo'sha olsin</label>
    <div class="row"><button class="primary" id="ng-go">Yaratish</button><button data-close>Bekor qilish</button></div>`, m => {
    $("#ng-name",m).focus();
    $("#ng-go",m).addEventListener("click", async e => {
      const name = $("#ng-name",m).value.trim(); if (!name) return toast("Guruh nomini yozing.");
      let titles = splitTitles($("#ng-secs",m).value);
      const cnt = +$("#ng-count",m).value || 0;
      if (!titles.length && cnt>0) titles = Array.from({length:Math.min(cnt,300)},(_,i)=>`${i+1}-bo'lim`);
      e.target.disabled = true;
      try { const r = await api("POST","/api/groups",{ name, book:$("#ng-book",m).value.trim(), sections:titles, membersCanEdit:$("#ng-mce",m).checked });
        closeModal(); go("/g/"+r.code); toast("Guruh yaratildi. Endi savollarni qo'shing."); }
      catch(err){ e.target.disabled = false; toast(err.message); }
    });
  });
}
function joinDialog(){
  modal(`<h3>Kod bilan kirish</h3><label class="f">Guruh kodi<input id="jc" class="mono" placeholder="Masalan: K7PX2M" autocomplete="off" style="text-transform:uppercase;letter-spacing:.12em"></label>
    <div class="row"><button class="primary" id="jgo">Kirish</button><button data-close>Bekor qilish</button></div>`, m => {
    const goJoin = () => { const c = $("#jc",m).value.toUpperCase().replace(/[^A-Z0-9]/g,""); if (c.length<4) return toast("Kodni to'liq kiriting."); closeModal(); go("/g/"+c); };
    $("#jc",m).focus(); $("#jgo",m).addEventListener("click", goJoin); $("#jc",m).addEventListener("keydown", e=>{ if(e.key==="Enter") goJoin(); });
  });
}
function addSectionsDialog(){
  modal(`<h3>Bo'lim qo'shish</h3><label class="f">Bo'lim nomlari (har qatorga bittadan)<textarea id="as" rows="6" placeholder="Kasrlar&#10;Tenglamalar"></textarea></label>
    <div class="row"><button class="primary" id="asgo">Qo'shish</button><button data-close>Bekor qilish</button></div>`, m => {
    $("#as",m).focus();
    $("#asgo",m).addEventListener("click", async e => {
      const titles = splitTitles($("#as",m).value); if (!titles.length) return toast("Kamida bitta nom yozing.");
      e.target.disabled = true;
      try { const r = await api("POST", `/api/groups/${S.code}/sections`, { titles }); closeModal(); toast(`${r.added} ta bo'lim qo'shildi${r.skipped?`, ${r.skipped} tasi oldin bor edi`:""}.`); loadGroup(); }
      catch(err){ e.target.disabled = false; toast(err.message); }
    });
  });
}

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  const link = e.target.closest("a[data-link]");
  if (link && !e.metaKey && !e.ctrlKey){ e.preventDefault(); go(link.getAttribute("href")); return; }
  const anchor = e.target.closest('a[href^="#"]');
  if (anchor){ e.preventDefault(); const el = document.getElementById(anchor.getAttribute("href").slice(1)); if (el) el.scrollIntoView({behavior:"smooth",block:"start"}); else { go("/"); setTimeout(()=>document.getElementById(anchor.getAttribute("href").slice(1))?.scrollIntoView({behavior:"smooth"}), 50); } return; }
  const t = e.target.closest("button"); if (!t || t.closest("#modal-root")) return;
  const a = t.dataset.act;
  if (t.dataset.auth){ authMode = t.dataset.auth; render(); if (t.hasAttribute("data-scroll")){ const c = $("#auth-card"); c?.scrollIntoView({behavior:"smooth",block:"center"}); setTimeout(()=>$("#authform input")?.focus({preventScroll:true}), 400); } return; }
  if (t.dataset.tab){ S.tab = t.dataset.tab; editing=null; render(); if (S.tab==="results") loadResults(); if (S.tab==="settings") loadMembers(); return; }
  if (t.dataset.resetpw){ const u = S.members?.find(x=>x.id===+t.dataset.resetpw); if (!u) return;
    confirmDialog(`${esc(u.name)} (${esc(u.username)}) uchun yangi vaqtinchalik parol yaratilsinmi? Eski parol ishlamay qoladi.`,"Parolni tiklash", async()=>{
      try { const r = await api("POST",`/api/groups/${S.code}/members/${u.id}/reset-password`); tempPasswordDialog(u, r.password); }
      catch(err){ toast(err.message); } }); return; }
  if (t.dataset.start){ startQuizDialog(t.dataset.start, +t.dataset.sid); return; }
  if (t.dataset.pick){ pick(+t.dataset.pick); return; }
  if (t.dataset.addq){ S.tab="questions"; S.filterSec=t.dataset.addq; editing=null; render(); $("#qq")?.focus(); return; }
  if (t.dataset.editq){ editing=+t.dataset.editq; const q=questions().find(x=>x.id===editing); $("#qform").innerHTML = qFormHTML(q); $("#qform").scrollIntoView({behavior:"smooth"}); return; }
  if (t.dataset.delq){ const id=t.dataset.delq; confirmDialog("Bu savol o'chirilsinmi?","O'chirish", async()=>{ try{ await api("DELETE","/api/questions/"+id); toast("O'chirildi"); loadGroup(); }catch(err){ toast(err.message); } }); return; }
  if (t.dataset.move){ try { await api("POST", `/api/sections/${t.dataset.sid}/move`, { dir:t.dataset.move }); loadGroup(); } catch(err){ toast(err.message); } return; }
  if (t.dataset.delsec){ const id=+t.dataset.delsec; const n=questions().filter(q=>q.sectionId===id).length;
    confirmDialog(`“${esc(sections().find(s=>s.id===id)?.title)}” bo'limi o'chirilsinmi?${n?` Undagi ${n} ta savol ham o'chiriladi.`:""}`,"O'chirish", async()=>{
      try { await api("DELETE","/api/sections/"+id); toast("Bo'lim o'chirildi"); loadGroup(); } catch(err){ toast(err.message); } }); return; }
  switch(a){
    case "theme": { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"); const nt = cur==="dark"?"light":"dark"; document.documentElement.dataset.theme = nt; store.set("theme", nt); try{ localStorage.setItem("tt:theme", nt); }catch{} renderUser(); break; }
    case "copy-card": copy(CARD_NO); break;
    case "forgot": forgotDialog(); break;
    case "profile": profileDialog(); break;
    case "admin": adminDialog(); break;
    case "logout": await api("POST","/api/logout").catch(()=>{}); S.user=null; authMode="login"; S.groups=null; renderUser(); go("/"); break;
    case "new-group": newGroupDialog(); break;
    case "join": joinDialog(); break;
    case "share": copy(shareLink()); break;
    case "copy-code": copy(S.code); break;
    case "add-sections": addSectionsDialog(); break;
    case "add-opt": { const box=$("#qopts"); const n=box.children.length; if (n>=6) return toast("Ko'pi bilan 6 ta variant."); box.insertAdjacentHTML("beforeend", optRow(n,"",false)); break; }
    case "save-q": saveQuestion(); break;
    case "cancel-edit": editing=null; $("#qform").innerHTML=qFormHTML(); break;
    case "template": downloadTemplate(); break;
    case "do-import": doImport(); break;
    case "clear-import": S.importRows=null; render(); break;
    case "export": exportResults(); break;
    case "save-group": try { await api("PATCH","/api/groups/"+S.code,{ name:$("#gname").value.trim(), book:$("#gbook").value.trim(), membersCanEdit:$("#gmce").checked }); toast("Saqlandi"); loadGroup(); } catch(err){ toast(err.message); } break;
    case "save-secnames": try { for (const s of sections()){ const v = $(`[data-secname="${s.id}"]`)?.value.trim(); if (v && v!==s.title) await api("PATCH","/api/sections/"+s.id,{ title:v }); } toast("Saqlandi"); loadGroup(); } catch(err){ toast(err.message); } break;
    case "leave": confirmDialog("Guruhdan chiqilsinmi? Havola orqali qayta kirishingiz mumkin.","Chiqish", async()=>{ try { await api("DELETE",`/api/groups/${S.code}/membership`); go("/"); } catch(err){ toast(err.message); } }); break;
    case "del-group": confirmDialog("Guruh, undagi barcha savollar va natijalar butunlay o'chirilsinmi? Buni qaytarib bo'lmaydi.","Guruhni o'chirish", async()=>{
      try { await api("DELETE","/api/groups/"+S.code); toast("Guruh o'chirildi"); go("/"); } catch(err){ toast(err.message); } }); break;
    case "quit": confirmDialog("Testdan chiqilsinmi? Bu urinish natijasi saqlanmaydi.","Chiqish", async()=>{ clearInterval(tick); S.quiz=null; S.view="group"; render(); }); break;
    case "next": next(); break;
    case "skip": skip(); break;
    case "resave": finish(); break;
    case "retry": { const Q=S.quiz; startQuiz(Q.mode, Q.sid, shuffle(Q.items.map(x=>x.q)), Q.exam, Q.title); break; }
    case "retry-wrong": { const Q=S.quiz; startQuiz("mistakes", null, shuffle(Q.items.filter(x=>!isRight(x)).map(x=>x.q)), Q.exam, "Xatolar ustida ishlash"); break; }
    case "back-group": S.quiz=null; S.view="group"; S.tab="tests"; render(); loadGroup(); break;
  }
});
document.addEventListener("submit", e => { if (e.target.id==="authform") submitAuth(e); });
document.addEventListener("input", e => {
  if (e.target.id==="qq"){ const d=findDup(e.target.value, editing); const w=$("#dupwarn"); if (w) w.innerHTML = d ? `<div class="notice">Bu savol allaqachon bor (${esc(secName(d.sectionId))}). Takror savol qabul qilinmaydi.</div>` : ""; }
  if (e.target.id==="fsearch"){ S.search=e.target.value; const pos=e.target.selectionStart; render(); const f=$("#fsearch"); f.focus(); f.setSelectionRange(pos,pos); }
});
document.addEventListener("change", e => {
  if (e.target.id==="fsec"){ S.filterSec=e.target.value; render(); }
  if (e.target.id==="file"){ handleFile(e.target.files[0]); }
  if (e.target.id==="firstok"){ store.set("firstok", e.target.checked); }
});
document.addEventListener("keydown", e => {
  if (S.view!=="quiz" || $("#modal-root").innerHTML || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const it = S.quiz.items[S.quiz.i];
  const k = e.key.toUpperCase();
  let j = LETTERS.indexOf(k); if (j<0 && /^[1-6]$/.test(k)) j = +k-1;
  if (j>=0 && j<it.order.length && it.pick===null){ e.preventDefault(); pick(j); }
  else if (e.key==="Enter" && it.pick!==null){ e.preventDefault(); next(); }
});
function afterRender(){
  const drop = $("#drop");
  if (drop){
    drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", ()=>drop.classList.remove("over"));
    drop.addEventListener("drop", e=>{ e.preventDefault(); drop.classList.remove("over"); handleFile(e.dataTransfer.files[0]); });
  }
}
window.addEventListener("beforeunload", e => { if (S.view==="quiz") { e.preventDefault(); e.returnValue = ""; } });

/* ---------- boot ---------- */
(async () => {
  try { S.user = (await api("GET","/api/me")).user; } catch {}
  renderUser(); route();
})();
})();
