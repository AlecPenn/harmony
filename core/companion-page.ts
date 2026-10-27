/** SHA-256 and HMAC in plain JavaScript for the phone page: browsers only offer crypto.subtle on HTTPS, and this page is
 * served over the home network. Checked against node:crypto in tests/companion.test.ts. */
export const PAGE_CRYPTO=`const SHA_K=[];(()=>{let n=2,c=0;const f=x=>(x-Math.floor(x))*4294967296|0;while(c<64){let p=true;for(let d=2;d*d<=n;d++)if(n%d===0){p=false;break;}if(p)SHA_K[c++]=f(Math.cbrt(n));n++;}})();
function sha256(bytes){const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],l=bytes.length,m=new Uint8Array(((l+9+63)>>6)<<6);m.set(bytes);m[l]=128;
 const dv=new DataView(m.buffer);dv.setUint32(m.length-4,l*8>>>0);dv.setUint32(m.length-8,Math.floor(l/536870912));const w=new Int32Array(64),r=(x,k)=>x>>>k|x<<32-k;
 for(let o=0;o<m.length;o+=64){for(let i=0;i<16;i++)w[i]=dv.getInt32(o+i*4);for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(r(a,7)^r(a,18)^a>>>3)+w[i-16]+(r(b,17)^r(b,19)^b>>>10)+w[i-7]|0;}
  let [a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const t1=h+(r(e,6)^r(e,11)^r(e,25))+(e&f^~e&g)+SHA_K[i]+w[i]|0,t2=(r(a,2)^r(a,13)^r(a,22))+(a&b^a&c^b&c)|0;h=g;g=f;f=e;e=d+t1|0;d=c;c=b;b=a;a=t1+t2|0;}
  H[0]=H[0]+a|0;H[1]=H[1]+b|0;H[2]=H[2]+c|0;H[3]=H[3]+d|0;H[4]=H[4]+e|0;H[5]=H[5]+f|0;H[6]=H[6]+g|0;H[7]=H[7]+h|0;}
 const out=new Uint8Array(32);H.forEach((x,i)=>{out[i*4]=x>>>24;out[i*4+1]=x>>>16;out[i*4+2]=x>>>8;out[i*4+3]=x;});return out;}
const utf8=s=>new TextEncoder().encode(s),hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
function hmac(key,msg){let k=utf8(key);if(k.length>64)k=sha256(k);const p=new Uint8Array(64);p.set(k);const ip=p.map(x=>x^54),op=p.map(x=>x^92),mb=utf8(msg);
 const a=new Uint8Array(64+mb.length);a.set(ip);a.set(mb,64);const ih=sha256(a),b=new Uint8Array(96);b.set(op);b.set(ih,64);return hex(sha256(b));}
function nonce(){const b=new Uint8Array(16);crypto.getRandomValues(b);return hex(b);}`;
/** The phone page: one self-contained file, no outside resources. All data is shown with textContent, never as HTML. */
export const COMPANION_PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0918"><title>HARMONY</title><style>
:root{color-scheme:dark;--p:#a777ff;--b:#648dff;--k:#ff65bc;--bg:#07060f;--card:#14112a;--t:#f2efff;--m:#a6a2c8}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -10%,#2a1a55,var(--bg) 60%);color:var(--t);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;padding:16px 16px calc(16px + env(safe-area-inset-bottom))}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.brand{display:flex;gap:10px;align-items:center;font-weight:600;letter-spacing:3px}
.h{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,#c8a8ff,#6a3df0);box-shadow:0 0 22px #8f5bff99;font-weight:700;letter-spacing:0}
#stop{background:#ff3d7f;color:#fff;border:0;border-radius:999px;padding:9px 18px;font-weight:700;letter-spacing:2px}
section{background:var(--card);border:1px solid #7470bd33;border-radius:16px;padding:14px;margin-bottom:12px}h2{font-size:11px;letter-spacing:2px;color:var(--m);margin:0 0 8px;font-weight:600}
form{display:flex;gap:8px}input,textarea{flex:1;min-width:0;background:#0b0918;border:1px solid #7470bd55;border-radius:12px;color:var(--t);padding:11px;font:inherit}
button{font:inherit;cursor:pointer}.go{background:var(--p);color:#0b0918;border:0;border-radius:12px;padding:0 16px;font-weight:700}
.chips{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.chip{background:transparent;border:1px solid #7470bd66;color:var(--t);border-radius:999px;padding:5px 12px;font-size:13px}
#reply{white-space:pre-wrap;margin-top:10px;min-height:1.5em}#reply.thinking{color:var(--m)}ul{list-style:none;margin:0;padding:0}li{padding:6px 0;border-top:1px solid #ffffff0d;font-size:14px}li:first-child{border:0}
small{color:var(--m)}#apsec{border-color:#ffc86a88;box-shadow:0 0 30px #ffc86a33}.ap{padding:8px 0}.ap b{display:block;font-size:17px}.nums{display:flex;gap:10px;margin:12px 0 8px}.num{flex:1;font-size:26px;font-weight:700;padding:14px 0;border-radius:14px;border:1px solid #ffc86a88;background:#1d1830;color:#ffe2a8}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.deny{background:transparent;border:1px solid #ff6b9a88;color:#ffb3cb;border-radius:999px;padding:6px 14px}#alsec{border-color:#ff6b9a88}#lock{background:transparent;color:var(--t);border:1px solid #7470bd66;border-radius:999px;padding:9px 14px;margin-right:8px}.err{color:#ff9ac4}.hidden{display:none}#pair input{font-size:28px;letter-spacing:10px;text-align:center}
</style></head><body>
<header><div class="brand"><div class="h">H</div>HARMONY</div><div><button id="lock" class="hidden">LOCK</button><button id="stop" class="hidden">STOP</button></div></header>
<section id="pair" class="hidden"><h2>PAIR THIS PHONE</h2><p>On your PC: HARMONY → Settings → Phone companion → <b>Show pairing code</b>.</p>
<form id="pairform"><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Pairing code"><button class="go">Pair</button></form><p id="pairerr" class="err"></p></section>
<div id="main" class="hidden">
<section id="apsec" class="hidden"><h2>APPROVE?</h2><div id="aps"></div></section>
<section id="alsec" class="hidden"><h2>SECURITY</h2><ul id="alerts"></ul><button id="unlock" class="go hidden" style="padding:10px 16px;margin-top:8px">Unlock HARMONY</button></section>
<section><h2 id="status">ASK HARMONY</h2><form id="ask"><input id="text" placeholder="Type, or tap your keyboard's mic" aria-label="Message" maxlength="2000" autocomplete="off"><button class="go">Send</button></form>
<div class="chips"><button class="chip" data-p="Idea: ">Idea</button><button class="chip" data-s="Harmony, status.">Status</button><button class="chip" data-s="Where was I?">Where was I?</button><button class="chip" data-s="Read me the research.">Research</button></div>
<div id="reply"></div><p id="askerr" class="err"></p></section>
<section id="noticesec" class="hidden"><h2>NOTICES</h2><ul id="notices"></ul></section>
<section id="remsec" class="hidden"><h2>COMING UP</h2><ul id="reminders"></ul></section>
<section id="missec" class="hidden"><h2>RESEARCH</h2><ul id="missions"></ul></section>
<section><h2>NOW</h2><p id="now"></p></section></div>
<script>
${PAGE_CRYPTO}
const $=id=>document.getElementById(id);let token=null,device=null;try{token=localStorage.getItem('harmony-token');device=localStorage.getItem('harmony-device');}catch(e){}
// Every request after pairing is signed with the phone's secret (which is never sent again); older pairings fall back to the token.
const api=async(path,body)=>{const method=body?'POST':'GET',text=body?JSON.stringify(body):'',h={'Content-Type':'application/json'};
 if(token&&device&&path!=='/api/pair'){const t=String(Date.now()),n=nonce();Object.assign(h,{'X-Harmony-Device':device,'X-Harmony-Time':t,'X-Harmony-Nonce':n,'X-Harmony-Sig':hmac(token,method+'\\n'+path+'\\n'+t+'\\n'+n+'\\n'+hex(sha256(utf8(text))))});}
 else if(token&&path!=='/api/pair')h.Authorization='Bearer '+token;
 const r=await fetch(path,{method,headers:h,body:body?text:undefined});
 if(r.status===401&&path!=='/api/pair'){token=null;device=null;try{localStorage.removeItem('harmony-token');localStorage.removeItem('harmony-device');}catch(e){}show();}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Error');return j;};
const show=()=>{$('pair').classList.toggle('hidden',!!token);$('main').classList.toggle('hidden',!token);$('stop').classList.toggle('hidden',!token);$('lock').classList.toggle('hidden',!token);};
const list=(el,items,fmt)=>{el.textContent='';for(const i of items){const li=document.createElement('li');const [a,b]=fmt(i);li.textContent=a;if(b){const s=document.createElement('small');s.textContent=' · '+b;li.appendChild(s);}el.appendChild(li);}el.parentElement.classList.toggle('hidden',!items.length);};
const when=s=>new Date(s).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});
let busy=false;
async function refresh(){if(!token)return;try{const s=await api('/api/state');const l=s.local||{};busy=l.state==='STARTING'||l.state==='STREAMING';
 $('status').textContent=busy?'THINKING…':'ASK HARMONY';const r=$('reply');r.textContent=l.text||(busy?'…':'');r.classList.toggle('thinking',busy);$('askerr').textContent=l.error||'';
 list($('notices'),s.notices||[],n=>[n.text,when(n.at)]);list($('reminders'),s.reminders||[],r=>[r.text,when(r.dueAt)]);list($('missions'),s.missions||[],m=>[m.objective,m.stage]);
 const g=s.guard||{};$('unlock').classList.toggle('hidden',!g.locked);list($('alerts'),(g.alerts||[]).concat(g.locked?[{text:(g.locked.strict?'Locked down: ':'Locked: ')+g.locked.reason,at:g.locked.at}]:[]),a=>[a.text,when(a.at)]);
 $('now').textContent=[s.project?('Project: '+s.project):'No current project',s.mode&&s.mode!=='normal'?('Mode: '+s.mode):''].filter(Boolean).join(' · ');}catch(e){}
 setTimeout(refresh,busy?1200:5000);}
$('pairform').onsubmit=async e=>{e.preventDefault();$('pairerr').textContent='';try{const j=await api('/api/pair',{code:$('code').value.trim(),name:/iPhone/.test(navigator.userAgent)?'iPhone':/Android/.test(navigator.userAgent)?'Android phone':'Phone'});token=j.token;device=j.device||null;try{localStorage.setItem('harmony-token',token);if(device)localStorage.setItem('harmony-device',device);}catch(e){}show();refresh();}catch(err){$('pairerr').textContent=err.message;}};
const send=async t=>{$('askerr').textContent='';try{await api('/api/ask',{text:t});$('text').value='';busy=true;$('reply').textContent='…';}catch(err){$('askerr').textContent=err.message;}};
$('ask').onsubmit=e=>{e.preventDefault();const t=$('text').value.trim();if(t)send(t);};
document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{if(c.dataset.s)send(c.dataset.s);else{$('text').value=c.dataset.p;$('text').focus();}});
$('stop').onclick=()=>api('/api/stop',{}).catch(()=>{});
$('lock').onclick=()=>api('/api/lock',{}).catch(()=>{});
$('unlock').onclick=()=>api('/api/unlock',{}).catch(e=>{$('askerr').textContent=e.message;});
// Approvals: HARMONY says or shows a number; tap the same one here. Checked every 2 seconds while this page is open.
let shown='';
async function approvals(){if(token&&device&&!document.hidden){try{const j=await api('/api/approvals');const list_=j.approvals||[],key=list_.map(a=>a.id).join();
 if(key!==shown){shown=key;const box=$('aps');box.textContent='';if(list_.length&&navigator.vibrate)navigator.vibrate([120,60,120]);
  for(const a of list_){const d=document.createElement('div');d.className='ap';const b=document.createElement('b');b.textContent=a.title;d.appendChild(b);
   if(a.detail){const sm=document.createElement('small');sm.textContent=a.detail;d.appendChild(sm);}
   const p=document.createElement('p');p.textContent='Tap the number HARMONY is showing:';d.appendChild(p);
   const nums=document.createElement('div');nums.className='nums';const trust=document.createElement('input');trust.type='checkbox';
   const answer=async(approve,pick)=>{try{const r=await api('/api/approve',{id:a.id,approve,pick,trust:trust.checked});p.textContent=r.result==='ok'?'Approved.':r.result==='wrong'?'Wrong number, so it was refused.':r.result==='denied'?'Refused.':'That request has ended.';nums.remove();}catch(e){p.textContent=e.message;}};
   for(const n of a.choices){const btn=document.createElement('button');btn.className='num';btn.textContent=String(n);btn.onclick=()=>answer(true,n);nums.appendChild(btn);}
   d.appendChild(nums);const row=document.createElement('div');row.className='row';const lab=document.createElement('label');lab.appendChild(trust);lab.appendChild(document.createTextNode(' Trust this for 10 minutes'));
   const no=document.createElement('button');no.className='deny';no.textContent='Refuse';no.onclick=()=>answer(false,null);row.appendChild(lab);row.appendChild(no);d.appendChild(row);box.appendChild(d);}
  $('apsec').classList.toggle('hidden',!list_.length);}}catch(e){}}
 setTimeout(approvals,2000);}
approvals();
show();refresh();
</script></body></html>`;
