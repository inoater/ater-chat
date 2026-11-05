#!/usr/bin/env node
/* =====================================================================
   ATER CHAT SERVER — zero dependencies, Node 18+
   Serves ater-live.html and runs Ater chat: accounts, live chat (SSE),
   Ater emotes, pins, polls, whispers, name colours, streaks, moderation.

     node ater-server.js                 -> http://localhost:8080
     PORT=3000 node ater-server.js
     HOST=0.0.0.0 node ater-server.js     (let other machines connect, e.g. when hosting it)
     ATER_OWNER=inoater node ater-server.js   (that account gets the broadcaster badge;
                                               otherwise the first account created does)
     ATER_DATA=/path/ater-data.json      where everything is saved (default: next to this file)
   ===================================================================== */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||8080,HOST=process.env.HOST||'127.0.0.1';
const PAGE=path.join(__dirname,process.env.ATER_PAGE||'index.html');
const DATA=process.env.ATER_DATA||path.join(__dirname,'ater-data.json');
const OWNER=String(process.env.ATER_OWNER||'').toLowerCase();
const COOKIE='ater_s',HIST_MAX=300,SESSION_DAYS=90;

/* ---------------- storage ---------------- */
let db={users:{},sessions:{},emotes:{},pins:[],bans:{},mutes:{},settings:{slow:0},history:[]};
try{db=Object.assign(db,JSON.parse(fs.readFileSync(DATA,'utf8')))}catch(e){if(e.code!=='ENOENT')console.error('Could not read',DATA,e.message)}
let saveT=0;
function save(){if(saveT)return;saveT=setTimeout(()=>{saveT=0;const tmp=DATA+'.tmp';fs.writeFile(tmp,JSON.stringify(db),e=>{if(e)return console.error('save failed',e.message);fs.rename(tmp,DATA,()=>{})})},800)}
const now=()=>Date.now();
const dayUTC=(t=now())=>new Date(t).toISOString().slice(0,10);
const lc=s=>String(s||'').toLowerCase().replace(/^@/,'');

/* ---------------- built-in Ater emotes (drawn here, served as SVG) ---------------- */
const RB='<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset=".3" stop-color="#a855f7"/><stop offset=".55" stop-color="#ec4899"/><stop offset=".8" stop-color="#f97316"/><stop offset="1" stop-color="#eab308"/></linearGradient></defs>';
const face=(fill,inner)=>`<circle cx="32" cy="33" r="27" fill="${fill}" stroke="#00000033" stroke-width="2"/>${inner}`;
const svg=b=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${RB}${b}</svg>`;
const BUILTIN={
  AterW:svg('<rect x="4" y="8" width="56" height="48" rx="14" fill="url(#r)"/><text x="32" y="45" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="34" fill="#fff">W</text>'),
  AterL:svg('<rect x="4" y="8" width="56" height="48" rx="14" fill="#2a2a2e" stroke="#ff5a52" stroke-width="3"/><text x="32" y="45" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="34" fill="#ff5a52">L</text>'),
  AterGG:svg('<rect x="2" y="12" width="60" height="40" rx="12" fill="#0b0b0c" stroke="url(#r)" stroke-width="4"/><text x="32" y="42" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="24" fill="#fff">GG</text>'),
  AterPog:svg(face('#f5c84c','<circle cx="22" cy="26" r="7" fill="#fff"/><circle cx="42" cy="26" r="7" fill="#fff"/><circle cx="22" cy="27" r="3.5" fill="#1a1204"/><circle cx="42" cy="27" r="3.5" fill="#1a1204"/><ellipse cx="32" cy="45" rx="7" ry="9" fill="#5b1d0e"/>')),
  AterLUL:svg(face('#f5c84c','<path d="M15 26q6-7 12 0M37 26q6-7 12 0" stroke="#1a1204" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M15 36q17 22 34 0z" fill="#5b1d0e"/><path d="M19 37q13 6 26 0" fill="#fff"/><path d="M10 30q-4 8 0 12M54 30q4 8 0 12" stroke="#7ad3ff" stroke-width="4" fill="none" stroke-linecap="round"/>')),
  AterSadge:svg(face('#8fa8ff','<path d="M16 24l10 4M48 24l-10 4" stroke="#14183a" stroke-width="3.5" stroke-linecap="round"/><circle cx="22" cy="32" r="3" fill="#14183a"/><circle cx="42" cy="32" r="3" fill="#14183a"/><path d="M24 48q8-6 16 0" stroke="#14183a" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M45 37q3 6 0 9q-3-3 0-9z" fill="#e6f7ff"/>')),
  AterCope:svg(face('#f5c84c','<circle cx="22" cy="29" r="3.5" fill="#1a1204"/><circle cx="42" cy="29" r="3.5" fill="#1a1204"/><path d="M22 45h20" stroke="#1a1204" stroke-width="3.5" stroke-linecap="round"/><path d="M50 12q5 8 0 12q-5-4 0-12z" fill="#7ad3ff"/>')),
  AterHmm:svg(face('#f5c84c','<path d="M15 22l11-3M38 24h11" stroke="#1a1204" stroke-width="3.5" stroke-linecap="round"/><circle cx="22" cy="30" r="3.5" fill="#1a1204"/><circle cx="43" cy="31" r="3.5" fill="#1a1204"/><path d="M26 46q6-3 12 1" stroke="#1a1204" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M40 60q-6-10 4-14l8-2q4 1 2 5l-6 3" fill="#e9b23a" stroke="#00000033" stroke-width="2"/>')),
  AterHype:svg('<path d="M32 4c4 10 18 16 18 32a18 18 0 0 1-36 0c0-8 4-13 8-16 0 6 3 9 6 9-3-9 0-19 4-25z" fill="url(#r)"/><path d="M32 30c3 5 9 8 9 15a9 9 0 0 1-18 0c0-5 5-8 9-15z" fill="#fff" opacity=".85"/>'),
  AterLove:svg('<path d="M32 56S6 40 6 22A13 13 0 0 1 32 15a13 13 0 0 1 26 7c0 18-26 34-26 34z" fill="url(#r)"/><path d="M18 20a7 7 0 0 1 8-3" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>')
};
const emoteVer={};
function emoteList(){
  const out=Object.keys(BUILTIN).map(n=>({name:n,url:'/api/emote/'+n,b:1}));
  for(const[n,e]of Object.entries(db.emotes))out.push({name:n,url:'/api/emote/'+n+'?v='+e.ts,by:e.by});
  return out;
}

/* ---------------- users, sessions ---------------- */
const NAME_RE=/^[A-Za-z0-9_]{3,20}$/,RESERVED=new Set(['system','ater','aterbot','admin','moderator','mod','everyone','here']);
function hashPw(pw,salt){return crypto.scryptSync(pw,salt,64).toString('hex')}
function isOwner(u){return u&&(u.roles||[]).includes('owner')}
function isMod(u){return u&&((u.roles||[]).includes('mod')||isOwner(u))}
function badges(u){
  const b=[];if(isOwner(u))b.push('owner');else if(isMod(u))b.push('mod');
  if(u.og)b.push('og');
  if(u.streak&&u.streak.n>=3&&u.streak.last>=dayUTC(now()-864e5))b.push('streak:'+u.streak.n);
  return b;
}
const pub=u=>u?{name:u.name,color:u.color||'',b:badges(u),mod:isMod(u),owner:isOwner(u)}:null;
function parseCookies(h){const o={};String(h||'').split(';').forEach(p=>{const i=p.indexOf('=');if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});return o}
function userOf(req){
  const t=parseCookies(req.headers.cookie)[COOKIE];if(!t)return null;
  const s=db.sessions[t];if(!s||s.exp<now()){if(s){delete db.sessions[t];save()}return null}
  return db.users[s.u]||null;
}
function setSession(req,res,u){
  const t=crypto.randomBytes(24).toString('base64url');db.sessions[t]={u:lc(u.name),exp:now()+SESSION_DAYS*864e5};save();
  const secure=(req.headers['x-forwarded-proto']||'')==='https'?'; Secure':'';
  res.setHeader('Set-Cookie',COOKIE+'='+t+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+SESSION_DAYS*86400+secure);
}
/* forget expired sessions now and then */
setInterval(()=>{let n=0;for(const[t,s]of Object.entries(db.sessions))if(s.exp<now()){delete db.sessions[t];n++}if(n)save()},36e5).unref();

/* ---------------- live clients (SSE) ---------------- */
const clients=new Map();let cidSeq=0;
const sse=(res,ev,data)=>{try{res.write('event: '+ev+'\ndata: '+JSON.stringify(data)+'\n\n')}catch{}};
function broadcast(ev,data,filter){for(const c of clients.values())if(!filter||filter(c))sse(c.res,ev,data)}
let presT=0;
function presence(){if(presT)return;presT=setTimeout(()=>{presT=0;broadcast('presence',presenceData())},1200)}
function presenceData(){
  const seen=new Map();for(const c of clients.values()){const u=c.u&&db.users[c.u];if(u&&!seen.has(c.u))seen.set(c.u,pub(u))}
  const rank=u=>u.owner?0:u.mod?1:2;
  return{n:clients.size,users:[...seen.values()].sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name))};
}
setInterval(()=>{for(const c of clients.values())try{c.res.write(': ping\n\n')}catch{}},25000).unref();

/* ---------------- polls ---------------- */
let poll=null,pollT=0,pollBT=0;
function pollPub(lu){if(!poll)return null;return{id:poll.id,q:poll.q,opts:poll.opts.map(o=>({t:o.t,n:o.n})),ends:poll.ends,by:poll.by,done:poll.done,total:poll.opts.reduce((a,o)=>a+o.n,0),mine:lu&&poll.voters[lu]!=null?poll.voters[lu]:null}}
function pollCast(){for(const c of clients.values())sse(c.res,'poll',pollPub(c.u))}
function pollStart(by,q,opts,secs){
  clearTimeout(pollT);
  poll={id:crypto.randomBytes(4).toString('hex'),q,opts:opts.map(t=>({t,n:0})),ends:now()+secs*1000,by,done:false,voters:{}};
  pollCast();pollT=setTimeout(pollEnd,secs*1000);
}
function pollEnd(){if(!poll||poll.done)return;poll.done=true;poll.ends=now();pollCast();const id=poll.id;clearTimeout(pollT);pollT=setTimeout(()=>{if(poll&&poll.id===id){poll=null;pollCast()}},60000)}
function vote(u,i){
  if(!poll||poll.done)return{error:'There is no poll running.'};
  i=+i;if(!(i>=0&&i<poll.opts.length))return{error:'That option does not exist.'};
  const k=lc(u.name);if(poll.voters[k]!=null)return{error:'You already voted.'};
  poll.voters[k]=i;poll.opts[i].n++;
  if(!pollBT)pollBT=setTimeout(()=>{pollBT=0;pollCast()},400);
  return{ok:true,mine:i};
}

/* ---------------- chat ---------------- */
const RT=new Map();
const mid=()=>now().toString(36)+crypto.randomBytes(3).toString('hex');
function post(msg){db.history.push(msg);if(db.history.length>HIST_MAX)db.history.splice(0,db.history.length-HIST_MAX);save();broadcast('msg',msg)}
function notice(text,filter){broadcast('notice',{ts:now(),text},filter)}
const fmtDur=ms=>{const m=Math.ceil(ms/6e4);return m>=1440?Math.round(m/1440)+'d':m>=60?Math.round(m/60)+'h':m+'m'};
function parseDur(s,def){const m=String(s||'').match(/^(\d+)\s*(s|m|h|d)?$/i);if(!m)return def;return +m[1]*({s:1e3,m:6e4,h:36e5,d:864e5}[(m[2]||'m').toLowerCase()])}
function findUser(n){return db.users[lc(n)]||null}

function command(u,text){
  const[c0,...rest]=text.trim().split(/\s+/),c=c0.toLowerCase(),arg=rest.join(' ');
  const needMod=()=>isMod(u)?null:{error:'Only moderators can use '+c+'.'};
  switch(c){
    case'/me':return null; /* handled as a normal message */
    case'/w':case'/whisper':case'/msg':case'/tell':{
      const to=findUser(rest[0]),body=rest.slice(1).join(' ').trim();
      if(!to)return{error:'No Ater account called '+(rest[0]||'that')+'.'};
      if(!body)return{error:'Usage: /w name message'};
      if(lc(to.name)===lc(u.name))return{error:'Whispering to yourself?'};
      const w={ts:now(),from:u.name,to:to.name,text:body.slice(0,500)};
      let online=false;for(const c2 of clients.values())if(c2.u===lc(to.name)){online=true;break}
      if(!online)return{error:to.name+' is not online right now.'};
      broadcast('whisper',w,c2=>c2.u===lc(to.name)||c2.u===lc(u.name));
      return{ok:true};
    }
    case'/color':case'/colour':{
      if(!arg||/^(reset|none|off)$/i.test(arg)){u.color='';save();return{ok:true,info:'Name colour reset.'}}
      if(!/^#[0-9a-f]{6}$/i.test(arg))return{error:'Use a hex colour, like /color #a855f7'};
      u.color=arg.toLowerCase();save();return{ok:true,info:'Name colour set to '+u.color+'.'};
    }
    case'/vote':return vote(u,(+arg||0)-1);
    case'/poll':{
      const e=needMod();if(e)return e;
      let secs=60,body=arg;const m=body.match(/^(\d{1,4})\s+(.*)$/);if(m){secs=Math.max(10,Math.min(1800,+m[1]));body=m[2]}
      const parts=body.split('|').map(s=>s.trim()).filter(Boolean);
      let q,opts;
      const qi=body.indexOf('?');
      if(qi>=0){q=body.slice(0,qi+1).trim();opts=body.slice(qi+1).split('|').map(s=>s.trim()).filter(Boolean)}
      else if(parts.length>=3){q=parts[0];opts=parts.slice(1)}
      else return{error:'Usage: /poll [seconds] Question? Option A | Option B'};
      if(opts.length<2)opts=['Yes','No'];
      pollStart(u.name,q.slice(0,200),opts.slice(0,8).map(o=>o.slice(0,80)),secs);return{ok:true};
    }
    case'/endpoll':{const e=needMod();if(e)return e;if(!poll)return{error:'No poll running.'};pollEnd();return{ok:true}}
    case'/pin':{
      const e=needMod();if(e)return e;if(!arg)return{error:'Usage: /pin text, or hover a message and press the pin.'};
      pinAdd({id:mid(),ts:now(),name:u.name,color:u.color||'',b:badges(u),text:arg.slice(0,500)},u.name);return{ok:true};
    }
    case'/unpin':{const e=needMod();if(e)return e;db.pins=[];save();broadcast('pins',db.pins);return{ok:true}}
    case'/mute':case'/timeout':{
      const e=needMod();if(e)return e;const t=findUser(rest[0]);if(!t)return{error:'No user called '+(rest[0]||'that')+'.'};
      if(isMod(t)&&!isOwner(u))return{error:'Moderators can not be muted.'};
      const d=parseDur(rest[1],6e5);db.mutes[lc(t.name)]=now()+d;save();notice(t.name+' was muted for '+fmtDur(d)+' by '+u.name+'.');return{ok:true};
    }
    case'/unmute':{const e=needMod();if(e)return e;delete db.mutes[lc(rest[0])];save();notice((rest[0]||'?')+' was unmuted.');return{ok:true}}
    case'/ban':{
      const e=needMod();if(e)return e;const t=findUser(rest[0]);if(!t)return{error:'No user called '+(rest[0]||'that')+'.'};
      if(isOwner(t)||(isMod(t)&&!isOwner(u)))return{error:'You can not ban '+t.name+'.'};
      db.bans[lc(t.name)]={by:u.name,ts:now(),why:rest.slice(1).join(' ')};save();purge(t.name);notice(t.name+' was banned by '+u.name+'.');return{ok:true};
    }
    case'/unban':{const e=needMod();if(e)return e;delete db.bans[lc(rest[0])];save();return{ok:true,info:(rest[0]||'?')+' is unbanned.'}}
    case'/purge':{const e=needMod();if(e)return e;const n=purge(rest[0]);return{ok:true,info:'Removed '+n+' messages from '+(rest[0]||'?')+'.'}}
    case'/clear':{const e=needMod();if(e)return e;db.history=[];save();broadcast('clear',{by:u.name});return{ok:true}}
    case'/slow':{const e=needMod();if(e)return e;const s=/^(off|0)$/i.test(arg)?0:Math.max(1,Math.min(300,parseInt(arg)||10));db.settings.slow=s;save();broadcast('settings',db.settings);notice(s?'Slow mode is on: one message every '+s+'s.':'Slow mode is off.');return{ok:true}}
    case'/mod':case'/unmod':{
      if(!isOwner(u))return{error:'Only the broadcaster can change moderators.'};
      const t=findUser(rest[0]);if(!t)return{error:'No user called '+(rest[0]||'that')+'.'};
      t.roles=(t.roles||[]).filter(r=>r!=='mod');if(c==='/mod')t.roles.push('mod');save();
      notice(t.name+(c==='/mod'?' is now a moderator.':' is no longer a moderator.'));presence();return{ok:true};
    }
    case'/emote':{
      const e=needMod();if(e)return e;
      if(/^(remove|delete|rm)$/i.test(rest[0]||'')){const n=rest[1];if(!db.emotes[n])return{error:BUILTIN[n]?'Built-in emotes stay.':'No emote called '+n+'.'};delete db.emotes[n];save();broadcast('emotes',emoteList());return{ok:true,info:'Removed '+n+'.'}}
      return{error:'Add emotes from chat settings. Remove with /emote remove Name'};
    }
    default:return{error:'Unknown command '+c+'. Type /help.'};
  }
}
function purge(name){const k=lc(name);let n=0;db.history=db.history.filter(m=>{if(lc(m.name)===k){broadcast('del',{id:m.id});n++;return false}return true});save();return n}
function pinAdd(p,by){p.by=by;db.pins=[p,...db.pins.filter(x=>x.id!==p.id)].slice(0,3);save();broadcast('pins',db.pins)}

function say(u,text,rpId){
  text=String(text||'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim();
  if(!text)return{error:'Say something first.'};
  if(text.length>500)text=text.slice(0,500);
  const k=lc(u.name),t=now(),rt=RT.get(k)||{};RT.set(k,rt);
  if(db.bans[k])return{error:'You are banned from Ater chat.'};
  if(db.mutes[k]>t)return{error:'You are muted for '+fmtDur(db.mutes[k]-t)+' more.'};
  if(text.startsWith('/')&&!/^\/me\s/i.test(text))return command(u,text);
  if(rt.last&&t-rt.last<450)return{error:'Slow down a little.'};
  if(!isMod(u)&&db.settings.slow&&rt.last&&t-rt.last<db.settings.slow*1000)return{error:'Slow mode: wait '+Math.ceil((db.settings.slow*1000-(t-rt.last))/1000)+'s.'};
  const lone=BUILTIN[text]||db.emotes[text]; /* a lone emote may repeat: that's how combos happen */
  if(!isMod(u)&&!lone&&rt.text===text&&t-rt.last<20000)return{error:'Duplicate message.'};
  let me=false;if(/^\/me\s/i.test(text)){me=true;text=text.slice(4).trim();if(!text)return{error:'/me what?'}}
  let rp=null;if(rpId){const o=db.history.find(m=>m.id===rpId);if(o)rp={id:o.id,n:o.name,t:o.text.slice(0,160)}}
  rt.last=t;rt.text=text;u.msgs=(u.msgs||0)+1;
  const d=dayUTC(t),s=u.streak||(u.streak={last:'',n:0});
  if(s.last!==d){s.n=s.last===dayUTC(t-864e5)?s.n+1:1;s.last=d}
  post({id:mid(),ts:t,name:u.name,color:u.color||'',b:badges(u),text,me,rp});
  return{ok:true};
}

/* ---------------- http ---------------- */
const tries=new Map();
function limited(ip){const t=now(),r=tries.get(ip)||{n:0,t};if(t-r.t>6e5){r.n=0;r.t=t}r.n++;tries.set(ip,r);return r.n>25}
function json(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((ok,no)=>{let s='',n=0;req.on('data',c=>{n+=c.length;if(n>500000){no(new Error('too big'));req.destroy()}else s+=c});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){no(e)}});req.on('error',no)})}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  const url=new URL(req.url,'http://x'),p=url.pathname,ip=req.socket.remoteAddress||'';
  try{
    if(req.method==='GET'&&(p==='/'||p==='/index.html'||p==='/'+path.basename(PAGE))){
      return fs.readFile(PAGE,(e,b)=>{if(e){res.writeHead(500);return res.end('Missing '+path.basename(PAGE))}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(b)});
    }
    if(req.method==='GET'&&p.startsWith('/api/emote/')){
      const n=decodeURIComponent(p.slice(11));
      const hd={'Cache-Control':'public, max-age=86400','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"};
      if(BUILTIN[n]){res.writeHead(200,{...hd,'Content-Type':'image/svg+xml'});return res.end(BUILTIN[n])}
      const e=db.emotes[n];if(!e){res.writeHead(404);return res.end()}
      res.writeHead(200,{...hd,'Content-Type':e.type});return res.end(Buffer.from(e.data,'base64'));
    }
    if(req.method==='GET'&&p==='/api/me'){const u=userOf(req);return json(res,200,{me:pub(u),server:'ater',version:1})}
    if(req.method==='GET'&&p==='/api/stream'){
      const u=userOf(req),id=++cidSeq;
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write('retry: 3000\n\n');
      clients.set(id,{res,u:u?lc(u.name):null});
      sse(res,'hello',{me:pub(u),history:db.history.slice(-150),pins:db.pins,poll:pollPub(u&&lc(u.name)),emotes:emoteList(),presence:presenceData(),settings:db.settings});
      presence();
      req.on('close',()=>{clients.delete(id);presence()});
      return;
    }
    if(req.method!=='POST'||!p.startsWith('/api/'))return json(res,404,{error:'Not found'});
    /* every write needs this header, which other sites can not send without asking first */
    if(req.headers['x-ater']!=='1')return json(res,403,{error:'Missing header'});
    const b=await body(req);
    if(p==='/api/auth/register'||p==='/api/auth/login'){
      if(limited(ip))return json(res,429,{error:'Too many tries. Wait a few minutes.'});
      const name=String(b.name||'').trim(),pw=String(b.password||'');
      if(p==='/api/auth/register'){
        if(!NAME_RE.test(name))return json(res,400,{error:'Names are 3 to 20 letters, numbers or _.'});
        if(RESERVED.has(lc(name)))return json(res,400,{error:'That name is reserved.'});
        if(db.users[lc(name)])return json(res,409,{error:'That name is taken.'});
        if(pw.length<8)return json(res,400,{error:'Use at least 8 characters for the password.'});
        const first=!Object.keys(db.users).length,salt=crypto.randomBytes(16).toString('hex');
        const u={name,salt,hash:hashPw(pw,salt),roles:(OWNER?lc(name)===OWNER:first)?['owner']:[],color:'',created:now(),og:Object.keys(db.users).length<100,msgs:0,streak:{last:'',n:0}};
        db.users[lc(name)]=u;save();setSession(req,res,u);return json(res,200,{me:pub(u)});
      }
      const u=db.users[lc(name)];
      if(!u||!crypto.timingSafeEqual(Buffer.from(hashPw(pw,u.salt),'hex'),Buffer.from(u.hash,'hex')))return json(res,401,{error:'Wrong name or password.'});
      if(OWNER&&lc(name)===OWNER&&!isOwner(u)){u.roles=[...(u.roles||[]),'owner'];save()}
      setSession(req,res,u);return json(res,200,{me:pub(u)});
    }
    if(p==='/api/auth/logout'){
      const t=parseCookies(req.headers.cookie)[COOKIE];if(t){delete db.sessions[t];save()}
      res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');return json(res,200,{ok:true});
    }
    const u=userOf(req);if(!u)return json(res,401,{error:'Sign in to chat.'});
    if(p==='/api/send')return json(res,200,say(u,b.text,b.rp));
    if(p==='/api/vote')return json(res,200,vote(u,b.i));
    if(!isMod(u))return json(res,403,{error:'Moderators only.'});
    if(p==='/api/del'){const m=db.history.find(x=>x.id===b.id);db.history=db.history.filter(x=>x.id!==b.id);save();broadcast('del',{id:b.id});if(db.pins.some(x=>x.id===b.id)){db.pins=db.pins.filter(x=>x.id!==b.id);broadcast('pins',db.pins)}return json(res,200,{ok:!!m})}
    if(p==='/api/pin'){const m=db.history.find(x=>x.id===b.id);if(!m)return json(res,404,{error:'That message is gone.'});pinAdd({...m},u.name);return json(res,200,{ok:true})}
    if(p==='/api/unpin'){db.pins=db.pins.filter(x=>x.id!==b.id);save();broadcast('pins',db.pins);return json(res,200,{ok:true})}
    if(p==='/api/poll'){const opts=(b.opts||[]).map(s=>String(s).trim()).filter(Boolean);if(!String(b.q||'').trim()||opts.length<2)return json(res,400,{error:'A question and at least two options.'});pollStart(u.name,String(b.q).slice(0,200),opts.slice(0,8).map(o=>o.slice(0,80)),Math.max(10,Math.min(1800,+b.secs||60)));return json(res,200,{ok:true})}
    if(p==='/api/emote'){
      const n=String(b.name||''),m=String(b.data||'').match(/^data:(image\/(?:png|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
      if(!/^[A-Za-z][A-Za-z0-9_]{1,23}$/.test(n))return json(res,400,{error:'Emote names: 2 to 24 letters, numbers or _, starting with a letter.'});
      if(BUILTIN[n]||db.emotes[n])return json(res,409,{error:'There is already an emote called '+n+'.'});
      if(!m)return json(res,400,{error:'PNG, GIF or WebP only.'});
      if(m[2].length*3/4>300000)return json(res,400,{error:'Keep emotes under 300 KB.'});
      db.emotes[n]={type:m[1],data:m[2],by:u.name,ts:now()};save();broadcast('emotes',emoteList());notice(u.name+' added the emote '+n+'.');return json(res,200,{ok:true});
    }
    return json(res,404,{error:'Not found'});
  }catch(e){console.error(e);if(!res.headersSent)json(res,400,{error:'Bad request'})}
});
server.on('error',e=>{if(e.code==='EADDRINUSE'){console.error('\n  Port '+PORT+' is already in use. Stop the other server, or run with PORT=8081 node ater-server.js\n');process.exit(1)}throw e});
server.listen(PORT,HOST,()=>{
  console.log('\n  Ater Live is up:  http://localhost:'+PORT+'\n');
  console.log('  Data file: '+DATA);
  console.log('  '+(OWNER?'Broadcaster account: '+OWNER:'The first account created becomes the broadcaster.')+'\n');
});
for(const sig of['SIGINT','SIGTERM'])process.on(sig,()=>{clearTimeout(saveT);try{fs.writeFileSync(DATA,JSON.stringify(db))}catch{}process.exit(0)});
