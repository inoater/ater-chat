/* =====================================================================
   small helpers
   ===================================================================== */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const LS={get(k,d){try{const v=JSON.parse(localStorage.getItem('ater:'+k));return v==null?d:v}catch{return d}},set(k,v){try{localStorage.setItem('ater:'+k,JSON.stringify(v))}catch{}},del(k){try{localStorage.removeItem('ater:'+k)}catch{}}};
const h=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e};
const icon=(id,cls)=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');if(cls)s.setAttribute('class',cls);const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#'+id);s.append(u);return s};
const escRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const nm=n=>String(n||'').toLowerCase().replace(/^@/,'');
const PN={at:'Ater',tw:'Twitch',kk:'Kick',yt:'YouTube'};
const PI={tw:'i-tw',kk:'i-kk',yt:'i-yt'};
const pmark=p=>{const s=h('span','pm '+p);if(p==='at')s.append(h('span','atb'));else s.append(icon(PI[p]));s.title=PN[p]||'';return s};
const pad=n=>String(n).padStart(2,'0');
const hms=s=>{s=Math.max(0,s|0);return pad(s/3600|0)+':'+pad(s/60%60|0)+':'+pad(s%60)};
const clock=ts=>new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const dayKey=(t=Date.now())=>{const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const ago=ts=>{const s=(Date.now()-ts)/1e3;if(s<60)return'just now';if(s<3600)return(s/60|0)+'m ago';if(s<86400)return(s/3600|0)+'h ago';return(s/86400|0)+'d ago'};
const backoff=n=>Math.min(30000,1000*2**n);
function toast(title,text,ms=3200){const t=$('#toast');t.replaceChildren();if(title)t.append(h('b',null,title));if(text)t.append(h('span',null,text));t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),ms)}
const bus=new EventTarget();
const emit=(type,detail)=>bus.dispatchEvent(new CustomEvent(type,{detail}));
const on=(type,f)=>bus.addEventListener(type,e=>f(e.detail));

/* =====================================================================
   SETTINGS
   ===================================================================== */
const SET=Object.assign({ts:false,logos:true,badges:true,combos:true,guestAsk:true,guestAuto:false,sv:true,fs:14,nobots:true,sound:false,ign:['nightbot','streamelements','streamlabs','moobot','fossabot','wizebot','botrix','sery_bot','kicklet'],alias:CONFIG.aliases},LS.get('set',{}));
const saveSet=()=>{LS.set('set',SET);emit('set',SET)};
let AR=null;
let ME=null; /* your Ater chat name once signed in */
function mkAR(){const a=[...(SET.alias||[]),ME||''].map(nm).filter(Boolean);AR=a.length?new RegExp('(^|[^\\w])@?('+a.map(escRe).join('|')+')(?![\\w])','i'):null}
mkAR();on('set',mkAR);
const isIgn=n=>SET.ign.includes(nm(n));
const isAlias=n=>(SET.alias||[]).map(nm).includes(nm(n));
const isSelf=n=>isAlias(n)||(!!ME&&nm(n)===nm(ME));

/* =====================================================================
   CHAT ENGINE — ported from Ater Chat (Twitch IRC, Kick Centrifugo via relay, YouTube Data API)
   Emits 'msg' with a plain object; every view renders it its own way.
   ===================================================================== */
const URL_RE=/https:\/\/[^\s<>"'`]+/gi;
function cleanUrl(u){u=u.replace(/[.,;:!?'"\]}]+$/,'');if(u.endsWith(')')&&!u.includes('('))u=u.slice(0,-1);return u}
function validUrl(u){try{return new URL(u).protocol==='https:'&&u.length>10}catch{return false}}
function extract(t){return (String(t||'').match(URL_RE)||[]).map(cleanUrl).filter(validUrl)}
function titleOf(t){const s=String(t||'').replace(URL_RE,' ').replace(/\s+/g,' ').trim();return s.length>2?s.slice(0,140):''}

const STATUS={at:{c:'',t:'off'},tw:{c:'',t:'off'},kk:{c:'',t:'off'},yt:{c:'',t:'off'},gtw:{c:'',t:'off'},gkk:{c:'',t:'off'}};
const CHAN={at:'ater',tw:'',kk:'',yt:'',gtw:'',gkk:''},ACTIVE={tw:false,kk:false,yt:false};
let YTVID='';
function status(p,c,t){STATUS[p]={c,t};emit('status',{p,c,t})}

/* ---- badges: descriptors, not DOM ---- */
const TWB={},TWK={broadcaster:'host',moderator:'mod',vip:'vip',subscriber:'sub',partner:'ver'};
function twSets(u){return TWB[u]||(TWB[u]=Promise.race([fetch(u).then(r=>r.ok?r.json():{}).then(j=>j.badge_sets||{}),new Promise(r=>setTimeout(()=>r({}),3000))]).catch(()=>({})))}
async function twBadges(spec,room){
  if(!spec)return[];
  const[gl,ch]=await Promise.all([twSets('https://badges.twitch.tv/v1/badges/global/display'),room?twSets('https://badges.twitch.tv/v1/badges/channels/'+room+'/display'):{}]);
  const out=[];
  for(const g of spec.split(',')){
    const[set,ver]=g.split('/');if(!set)continue;
    const v=((ch[set]||gl[set]||{}).versions||{})[ver];
    if(v)out.push({p:'tw',k:TWK[set]||'x',t:v.title||set,img:v.image_url_2x});
    else if(TWK[set])out.push({p:'tw',k:TWK[set],t:set});
  }
  return out;
}
const KKK={broadcaster:'host',moderator:'mod',vip:'vip',verified:'ver',subscriber:'sub',og:'og',founder:'founder',sub_gifter:'gifter',staff:'staff'};
function kickBadges(list,kickSub=[]){
  if(!Array.isArray(list))return[];
  const out=[];
  for(const b of list){
    if(!b||!b.type||!KKK[b.type])continue;
    const n=+b.count||0,t=String(b.text||b.type)+(n?' ('+n+')':'');
    const sb=b.type==='subscriber'?([...kickSub].reverse().find(x=>x.months<=n)||kickSub[0]):null;
    out.push({p:'kk',k:KKK[b.type],t,img:sb&&sb.badge_image.src});
  }
  return out;
}
function ytBadges(a){const o=[];if(!a)return o;if(a.isChatOwner)o.push({p:'yt',k:'host',t:'Channel owner'});if(a.isChatModerator)o.push({p:'yt',k:'mod',t:'Moderator'});if(a.isChatSponsor)o.push({p:'yt',k:'sub',t:'Member'});if(a.isVerified)o.push({p:'yt',k:'ver',t:'Verified'});return o}

/* ---- tokens: strings and {url,name,src,w} emotes ---- */
function twTokens(t,spec){
  if(!spec)return[t];
  const cp=Array.from(t),r=[];
  for(const g of spec.split('/')){const[id,pos]=g.split(':');if(!pos)continue;for(const x of pos.split(',')){const[a,b]=x.split('-').map(Number);if(a>=0&&b>=a)r.push({a,b,id})}}
  r.sort((x,y)=>x.a-y.a);
  const out=[];let i=0;
  for(const e of r){if(e.a<i)continue;if(e.a>i)out.push(cp.slice(i,e.a).join(''));out.push({url:'https://static-cdn.jtvnw.net/emoticons/v2/'+e.id+'/default/dark/2.0',name:cp.slice(e.a,e.b+1).join(''),src:'tw'});i=e.b+1}
  if(i<cp.length)out.push(cp.slice(i).join(''));
  return out;
}
function kickTokens(s){
  const out=[];let i=0;
  for(const m of s.matchAll(/\[emote:(\d+):([^\]]+)\]/g)){if(m.index>i)out.push(s.slice(i,m.index));out.push({url:'https://files.kick.com/emotes/'+m[1]+'/fullsize',name:m[2],src:'kk'});i=m.index+m[0].length}
  if(i<s.length)out.push(s.slice(i));
  return out.length?out:[s];
}
function ytTokens(s){return s.split(/((?<![\w:]):[A-Za-z_][\w-]{1,40}:(?![\w:]))/).map((x,i)=>i%2?{name:x,src:'yt'}:x).filter(x=>x!=='')}

/* ---- 7TV ---- */
const SEV={g:null,ch:{}},SVP={at:'twitch',tw:'twitch',kk:'kick',yt:'youtube'};
function sevLoad(url,pick){
  const o={map:null,done:false,waited:false};
  o.p=fetch(url).then(r=>r.ok?r.json():null).then(j=>{
    const set=pick(j),m=new Map();
    for(const e of (set&&set.emotes)||[]){
      if(!e||!e.id||!e.name)continue;
      const f=((e.data&&e.data.host&&e.data.host.files)||[]).find(x=>x.name==='2x.webp');
      m.set(e.name,{url:'https://cdn.7tv.app/emote/'+e.id+'/2x.webp',w:f&&f.width&&f.height?Math.min(112,Math.round(28*f.width/f.height)):0});
    }
    o.map=m;emit('emotesets');
  }).catch(()=>{}).then(()=>{o.done=true});
  return o;
}
async function sevWait(p,room){
  const a=SEV.g||(SEV.g=sevLoad('https://7tv.io/v3/emote-sets/global',j=>j));
  const k=p+':'+room,b=room?(SEV.ch[k]||(SEV.ch[k]=sevLoad('https://7tv.io/v3/users/'+SVP[p]+'/'+encodeURIComponent(room),j=>j&&j.emote_set))):null;
  const os=[a,b].filter(Boolean),pend=os.filter(o=>!o.done&&!o.waited);
  if(pend.length){pend.forEach(o=>o.waited=true);await Promise.race([Promise.all(pend.map(o=>o.p)),new Promise(r=>setTimeout(r,2500))])}
  return os.map(o=>o.map);
}
function sevApply(toks,maps){
  const[g,c]=maps||[];
  if(!(g&&g.size)&&!(c&&c.size))return toks;
  const out=[];
  const push=t=>{if(typeof t==='string'){if(t==='')return;if(typeof out[out.length-1]==='string'){out[out.length-1]+=t;return}}out.push(t)};
  for(const t of toks){
    if(typeof t!=='string'){out.push(t);continue}
    for(const w of t.split(/(\s+)/)){const e=(c&&c.get(w))||(g&&g.get(w));push(e?{url:e.url,name:w,w:e.w,src:'7tv'}:w)}
  }
  return out;
}
/* every emote set we know about, for the picker */
function knownEmotes(){
  const out=[],seen=new Set();
  const add=(sec,name,url)=>{if(seen.has(name))return;seen.add(name);out.push({sec,name,url})};
  for(const e of ATER.list||[]){const u=ATER.emotes.get(e.name);if(u)add(e.set==='7tv'?'Ater · 7TV':'Ater',e.name,u)}
  for(const[k,o]of Object.entries(SEV.ch))if(o.map)for(const[n,e]of o.map)add('7TV · '+k.split(':')[1],n,e.url);
  for(const[n,u]of SEEN_EMO)add('Seen in chat',n,u);
  if(SEV.g&&SEV.g.map)for(const[n,e]of SEV.g.map)add('7TV global',n,e.url);
  return out;
}
const SEEN_EMO=new Map();

/* ---- the pipeline: resolve 7TV + badges in order, then publish ---- */
let seq=0,sq=Promise.resolve();
function sevMsg(p,room,name,text,color,toks,bds,ev,rp,extra){
  sq=sq.then(async()=>{
    const[maps,b]=await Promise.all([sevWait(p,room).catch(()=>[]),Promise.resolve(bds).catch(()=>[])]);
    publish({p,room,name:String(name||'unknown'),text:String(text||''),color:/^#[0-9a-f]{6}$/i.test(color||'')?color:'',toks:sevApply(toks||[text],maps),bds:b||[],ev,rp,...(extra||{})});
  }).catch(e=>console.warn(e));
}
const BUF=[],BUF_MAX=600;
function publish(m){
  m.id=++seq;m.ts=m.ts0||Date.now();m.ch=CHAN[m.p];
  m.urls=extract(m.text);
  m.mention=!m.guest&&!!(AR&&!isSelf(m.name)&&AR.test(m.text+' '+(m.rp?m.rp.n:'')));
  m.bot=isIgn(m.name)||/^!\w/.test(m.text);
  for(const t of m.toks)if(t&&t.url&&t.src!=='7tv')SEEN_EMO.set(t.name,t.url);
  BUF.push(m);if(BUF.length>BUF_MAX)BUF.shift();
  emit('msg',m);
}

/* ---- Twitch ---- */
const tt=s=>Object.fromEntries((s||'').split(';').map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
const un=v=>String(v||'').replace(/\\([s:\\])/g,(_,c)=>({s:' ',':':';','\\':'\\'})[c]);
function twCash(g){
  if(+g.bits)return{k:'cash',t:'cheered '+(+g.bits)+' bits'};
  const a=+g['pinned-chat-paid-amount'],x=+g['pinned-chat-paid-exponent']||0;
  if(a)return{k:'cash',t:'sent a Hype Chat of '+(a/10**x).toFixed(x)+' '+(g['pinned-chat-paid-currency']||'')};
  return null;
}
function twReply(g){const n=un(g['reply-parent-display-name']||g['reply-parent-user-login']);return n?{n,t:un(g['reply-parent-msg-body'])}:null}
function twStrip(tk,g){const l=g['reply-parent-user-login'];if(l&&typeof tk[0]==='string'){tk[0]=tk[0].replace(new RegExp('^@'+l+'\\s+','i'),'');if(tk[0]==='')tk.shift()}return tk}
function twNotice(u,x){
  const g=tt(u[1]),id=g['msg-id'],t=u[2]||'',PL={Prime:'Prime','1000':'Tier 1','2000':'Tier 2','3000':'Tier 3'};
  let n=un(g['display-name']||g.login),k,hd;
  const pl=PL[g['msg-param-sub-plan']]||'',pt=pl?' ('+pl+')':'';
  if(id==='sub'){k='sub';hd='subscribed'+pt}
  else if(id==='resub'){k='sub';hd='resubscribed for '+g['msg-param-cumulative-months']+' months'+pt}
  else if(id==='subgift'){if(g['msg-param-community-gift-id'])return;k='gift';hd='gifted a '+(pl||'')+' sub to '+un(g['msg-param-recipient-display-name'])}
  else if(id==='submysterygift'){k='gift';hd='is gifting '+g['msg-param-mass-gift-count']+' '+pl+' subs'}
  else if(id==='giftpaidupgrade'||id==='anongiftpaidupgrade'){k='gift';hd='is continuing their gifted sub'}
  else if(id==='raid'){k='raid';n=un(g['msg-param-displayName']||n);hd='is raiding with '+g['msg-param-viewerCount']+' viewers'}
  else return;
  sevMsg('tw',g['room-id'],n,t,g.color,t?twTokens(t,g.emotes):[],null,{k,t:hd.replace(/\s+/g,' ')},null,x);
}
/* k: status key ('tw' for your channel, 'gtw' for a guest); x: extra fields for every message (guest marker) */
function Twitch(k='tw',x=null){
  let ws,stop=true,retry=0,ch,tm;
  function open(){
    status(k,'wait','connecting…');
    try{ws=new WebSocket('wss://irc-ws.chat.twitch.tv:443')}catch{status(k,'err','blocked');return}
    ws.onopen=()=>{ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');ws.send('PASS SCHMOOPIIE');ws.send('NICK justinfan'+(10000+Math.random()*80000|0));ws.send('JOIN #'+ch)};
    ws.onmessage=e=>String(e.data).split('\r\n').forEach(line=>{
      if(!line)return;
      if(line.startsWith('PING')){ws.send('PONG :tmi.twitch.tv');return}
      if(line.includes(' JOIN #')){retry=0;status(k,'on','#'+ch)}
      const u=line.match(/^(?:@(\S+) )?:tmi\.twitch\.tv USERNOTICE #\S+(?: :(.*))?$/);if(u){twNotice(u,x);return}
      if(/ CLEARCHAT #/.test(line)){const m=line.match(/CLEARCHAT #\S+ :(\S+)/);if(m)emit('purge',{p:'tw',name:m[1]});return}
      const m=line.match(/^(?:@(\S+) )?:([^!\s]+)![^ ]+ PRIVMSG #\S+ :(.*)$/);
      if(!m)return;
      const tags=tt(m[1]);
      let t=m[3];if(t.startsWith('\u0001ACTION '))t=t.slice(8,-1);
      sevMsg('tw',tags['room-id'],(tags['display-name']||m[2]).replace(/\\s/g,' '),t,tags.color,twStrip(twTokens(t,tags.emotes),tags),twBadges(tags.badges,tags['room-id']),twCash(tags),twReply(tags),x);
    });
    ws.onclose=()=>{if(stop)return;status(k,'wait','retrying…');tm=setTimeout(open,backoff(retry++))};
  }
  return{start(o){ch=String(o.ch||'').trim().replace(/^#/,'').replace(/^https?:\/\/(www\.)?twitch\.tv\//i,'').split(/[/?]/)[0].toLowerCase();if(!ch)return status(k,'err','enter a channel'),false;stop=false;retry=0;CHAN[k]=ch;open();return true},
    stop(){stop=true;clearTimeout(tm);if(ws){ws.onclose=null;try{ws.close()}catch{}}status(k,'','off')}};
}

/* ---- Kick (Centrifugo, through a relay since Oct 2026) ---- */
function kickReply(d){
  let m=d.metadata;if(typeof m==='string'){try{m=JSON.parse(m)}catch{m=null}}
  const o=m&&m.original_sender,c=m&&m.original_message;
  if(!o||!o.username)return null;
  return{n:String(o.username),t:String((c&&c.content)||'').replace(/\[emote:\d+:([^\]]+)\]/g,'$1')};
}
const KICK_ALERT=/^((App\\Events\\)?(SubscriptionEvent|GiftedSubscriptionsEvent|StreamHostEvent)|KicksGifted)$/,KICK_CHAT=/^(App\\Events\\)?ChatMessageEvent$/,kseen=new Map();
function kickAlert(m,kickUid,x){
  const key=m.event+m.data,now=Date.now(),was=kseen.get(key);
  if(was&&now-was<3000)return;kseen.set(key,now);if(kseen.size>100)kseen.delete(kseen.keys().next().value);
  let d;try{d=JSON.parse(m.data)}catch{return}
  const e=m.event.replace(/^App\\Events\\/,'');let n,k,hd,t='',c='';
  if(e==='SubscriptionEvent'){n=d.username;k='sub';hd=d.months>1?'resubscribed for '+d.months+' months':'subscribed'}
  else if(e==='GiftedSubscriptionsEvent'){n=d.gifter_username;k='gift';const l=d.gifted_usernames||[],q=l.length||1;hd='gifted '+q+(q>1?' subs':' sub')+(q===1&&l[0]?' to '+l[0]:'')}
  else if(e==='StreamHostEvent'){n=d.host_username;k='raid';hd='is hosting with '+d.number_viewers+' viewers';t=d.optional_message||''}
  else{const s=d.sender||{},g=d.gift||{};n=s.username;c=s.username_color;k='cash';hd='sent '+g.amount+' Kicks'+(g.name?' ('+g.name+')':'');t=d.message||''}
  if(!n)return;
  sevMsg('kk',kickUid,String(n),String(t),c,t?kickTokens(String(t)):[],null,{k,t:hd},null,x);
}
function relayBase(raw){
  let u=String(raw||'').trim()||CONFIG.kickRelay;
  if(!u)return'';
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(u))u='https://'+u;
  return u.replace(/^ws(s?):/i,'http$1:').replace(/\/+$/,'');
}
/* channel lookup: through the relay if it forwards it, else kick.com directly (often blocked from other sites), else the configured chatroom ID */
async function kickChannel(slug,rl){
  for(const base of[rl,'https://kick.com'].filter(Boolean)){
    try{const r=await fetch(base+'/api/v2/channels/'+encodeURIComponent(slug));if(!r.ok)continue;const j=await r.json();if(j&&j.chatroom&&j.chatroom.id)return j}catch{}
  }
  if(CONFIG.kickChatroom&&slug===String(CONFIG.channels.kick||'').toLowerCase())return{chatroom:{id:CONFIG.kickChatroom}};
  throw new Error('lookup failed');
}
const kickChannels=(id,ch)=>['chatrooms.'+id+'.v2','chatroom_'+id].concat(ch?['channel_'+ch]:[]);
function Kick(k='kk',x=null){
  let ws,stop=true,retry=0,id,gen=0,tm,dog,rt,rl='',kickUid='',kickCh='',kickSub=[];
  const seen=new Set();
  const uuid=()=>window.crypto&&crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:r&3|8).toString(16)});
  const post=async(api,path,body)=>{const r=await fetch(api+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('HTTP '+r.status);return(await r.json()).data||{}};
  function clear(){clearTimeout(tm);clearTimeout(dog);clearTimeout(rt);if(ws){ws.onopen=ws.onmessage=ws.onclose=ws.onerror=null;try{ws.close()}catch{}ws=null}}
  function giveUp(msg){stop=true;gen++;clear();status(k,'err',msg);if(k==='kk'){ACTIVE.kk=false;emit('active')}}
  function blocked(){if(navigator.onLine===false)return giveUp('offline');if(k==='kk')emit('kickhint',true);giveUp('relay needed')}
  function later(){if(stop)return;clear();status(k,'wait','retrying…');tm=setTimeout(open,backoff(retry++))}
  function push(p){
    const d0=p&&p.pub&&p.pub.data;if(!d0||!d0.event)return;
    const ev=String(d0.event),raw=typeof d0.data==='string'?d0.data:JSON.stringify(d0.data);
    if(KICK_CHAT.test(ev)){
      let d;try{d=JSON.parse(raw)}catch{return}
      if(!d||!d.sender)return;
      if(d.id){if(seen.has(d.id))return;seen.add(d.id);if(seen.size>500)seen.delete(seen.values().next().value)}
      const c=String(d.content==null?'':d.content),idn=d.sender.identity||{};
      sevMsg('kk',kickUid,d.sender.username,c.replace(/\[emote:\d+:([^\]]+)\]/g,'$1'),idn.color,kickTokens(c),kickBadges(idn.badges,kickSub),null,kickReply(d),x);
    }else if(KICK_ALERT.test(ev))kickAlert({event:ev,data:raw},kickUid,x);
  }
  async function open(){
    if(stop)return false;
    clear();const my=++gen,api=rl||'https://web.kick.com',cid=uuid();
    status(k,'wait','connecting…');
    let url,tok;
    try{
      const c=await post(api,'/api/v1/realtime/connection',{client:{id:cid,type:'web'},capabilities:{accepted_providers:[{provider:'centrifugo'}]}});
      const k=(c.connections||[]).find(x=>x&&x.provider==='centrifugo'&&x.credentials&&x.credentials.url);
      if(!k)throw new Error('no centrifugo connection');
      url=k.credentials.url;
      tok=(await post(api,'/api/v1/realtime/auth/connection',{client_id:cid})).token;
      if(!tok)throw new Error('no token');
    }catch(e){
      if(my!==gen||stop)return false;
      if(!rl){blocked();return false}
      status(k,'err',/^HTTP/.test(e.message)?'relay error '+e.message.slice(5):'relay unreachable');
      tm=setTimeout(later,1500);return true;
    }
    if(my!==gen||stop)return false;
    const wsUrl=rl?rl.replace(/^http/,'ws')+'/ws?to='+encodeURIComponent(url):url;
    let sock,opened=false,live=false,sid=1,ping=25,ttl=2700;
    try{sock=new WebSocket(wsUrl)}catch(e){if(!rl){blocked();return false}later();return true}
    ws=sock;
    const send=o=>{try{sock.send(typeof o==='string'?o:JSON.stringify(o))}catch{}};
    const arm=()=>{clearTimeout(dog);dog=setTimeout(()=>{if(my===gen)later()},(ping*2+15)*1000)};
    const refresh=async()=>{
      try{const t=(await post(api,'/api/v1/realtime/auth/connection',{client_id:cid})).token;if(my!==gen)return;if(!t)throw new Error('no token');send({refresh:{token:t},id:++sid})}
      catch(e){if(my===gen)later()}
    };
    function frame(m){
      if(!Object.keys(m).length){send('{}');return}
      if(m.error){const N=kickChannels(id,kickCh).length;if(m.id===1||m.id>1+N)return later();if(m.id===2)status(k,'err','subscribe failed');return}
      if(m.id===1&&m.connect){ping=m.connect.ping||25;ttl=m.connect.ttl||2700;arm();for(const c of kickChannels(id,kickCh))send({subscribe:{channel:c},id:++sid});rt=setTimeout(refresh,ttl*750);return}
      if(m.id===2&&m.subscribe&&!live){live=true;retry=0;status(k,'on',CHAN[k]);if(k==='kk')emit('kickhint',false);return}
      if(m.refresh&&m.id>1){clearTimeout(rt);rt=setTimeout(refresh,(+m.refresh.ttl||ttl)*750);return}
      if(m.push)return push(m.push);
    }
    sock.onopen=()=>{if(my!==gen)return;opened=true;arm();send({connect:{token:tok,name:'js'},id:1})};
    sock.onmessage=e=>{if(my!==gen)return;arm();for(const line of String(e.data).split('\n')){const t=line.trim();if(!t)continue;let m;try{m=JSON.parse(t)}catch{continue}frame(m)}};
    sock.onclose=()=>{if(my!==gen||stop)return;if(!opened&&!rl)return blocked();if(!opened)status(k,'err','relay error');later()};
    return true;
  }
  return{async start(o){
    const slug=String(o.ch||'').trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//i,'').split(/[/?]/)[0];id=String(o.id||'').trim();rl=relayBase(o.relay);
    if(!id&&!slug)return status(k,'err','enter a channel'),false;
    stop=false;gen++;clear();seen.clear();retry=0;
    kickUid='';kickCh='';kickSub=[];
    if(!id){
      status(k,'wait','looking up…');
      try{const j=await kickChannel(slug,rl);id=j.chatroom.id;kickSub=(j.subscriber_badges||[]).filter(b=>b&&b.badge_image&&b.badge_image.src).sort((a,b)=>a.months-b.months);kickUid=String(j.user_id||(j.user&&j.user.id)||'');kickCh=String(j.id||'')}catch{}
      if(!id){stop=true;status(k,'err',k==='kk'?'add the chatroom ID':'lookup blocked');return false}
    }
    CHAN[k]=slug||'chatroom-'+id;
    return open()},
    stop(){stop=true;gen++;clear();status(k,'','off')}};
}

/* ---- YouTube (Data API, your key) ---- */
let ytChan='';
function ytAlert(it){
  try{
    const s=it.snippet,n=it.authorDetails.displayName;let k,hd,x='';
    if(s.type==='superChatEvent'){const d=s.superChatDetails;k='cash';hd='sent a Super Chat of '+d.amountDisplayString;x=d.userComment||''}
    else if(s.type==='superStickerEvent'){k='cash';hd='sent a Super Sticker of '+s.superStickerDetails.amountDisplayString}
    else if(s.type==='newSponsorEvent'){const d=s.newSponsorDetails;k='sub';hd=d.isUpgrade?'upgraded to '+(d.memberLevelName||'a new level'):'became a member'+(d.memberLevelName?' ('+d.memberLevelName+')':'')}
    else if(s.type==='memberMilestoneChatEvent'){const d=s.memberMilestoneChatDetails;k='sub';hd='has been a member for '+d.memberMonth+' months';x=d.userComment||''}
    else if(s.type==='membershipGiftingEvent'){const d=s.membershipGiftingDetails;k='gift';hd='gifted '+d.giftMembershipsCount+' membership'+(d.giftMembershipsCount>1?'s':'')}
    else return;
    sevMsg('yt',ytChan,n,x,'',x?ytTokens(x):[],null,{k,t:hd});
  }catch(e){console.warn(e)}
}
function YouTube(){
  let timer,stop=true,key,chatId,tok,seen=new Set();
  async function api(path,q){const r=await fetch('https://www.googleapis.com/youtube/v3/'+path+'?'+new URLSearchParams({...q,key}));const j=await r.json();if(!r.ok)throw new Error(j.error&&j.error.message||r.status);return j}
  async function poll(){
    if(stop)return;let wait=8000;
    try{
      const q={liveChatId:chatId,part:'snippet,authorDetails',maxResults:200};if(tok)q.pageToken=tok;
      const j=await api('liveChat/messages',q);tok=j.nextPageToken;wait=Math.max(j.pollingIntervalMillis||0,6000);
      for(const it of j.items||[]){
        if(seen.has(it.id))continue;seen.add(it.id);
        if(it.snippet.type!=='textMessageEvent'){ytAlert(it);continue}
        const x=it.snippet.displayMessage||'';sevMsg('yt',ytChan,it.authorDetails.displayName,x,'',ytTokens(x),ytBadges(it.authorDetails));
      }
      status('yt','on',CHAN.yt);
    }catch(e){status('yt','err',/quota/i.test(e.message)?'quota used up':'error');wait=30000}
    if(!stop)timer=setTimeout(poll,wait);
  }
  return{async start(o){
    key=String(o.key||'').trim();const raw=String(o.ch||'').trim();
    const m=raw.match(/(?:v=|youtu\.be\/|live\/)([\w-]{11})/)||raw.match(/^([\w-]{11})$/);
    if(!key||!m)return status('yt','err','need a live URL and API key'),false;
    stop=false;tok=null;seen.clear();status('yt','wait','connecting…');
    try{
      const j=await api('videos',{part:'liveStreamingDetails,snippet',id:m[1]});
      const it=j.items&&j.items[0];
      ytChan=(it&&it.snippet&&it.snippet.channelId)||'';chatId=it&&it.liveStreamingDetails&&it.liveStreamingDetails.activeLiveChatId;
      if(!chatId)throw new Error('no live chat');
      CHAN.yt=(it.snippet&&it.snippet.channelTitle)||ytChan||m[1];YTVID=m[1];
    }catch(e){stop=true;status('yt','err',e.message==='no live chat'?'no live chat found':'API error');return false}
    poll();return true},
    stop(){stop=true;clearTimeout(timer);status('yt','','off')}};
}

/* ---- Ater chat (ater-server.js): our own chatters, emotes, pins, polls, whispers ---- */
const ATER={up:false,me:null,es:null,emotes:new Map(),ew:new Map(),list:[],pins:[],poll:null,pres:{n:0,users:[]},settings:{},seen:new Set()};
function aterBase(){if(CONFIG.server)return CONFIG.server.replace(/\/+$/,'');return/^https?:$/.test(location.protocol)?'':null}
async function aterApi(path,body){
  const b=aterBase();if(b==null)return{error:'Ater chat needs ater-server.js running.'};
  try{
    const r=await fetch(b+path,{method:body?'POST':'GET',credentials:'include',headers:body?{'content-type':'application/json','x-ater':'1'}:{},body:body?JSON.stringify(body):undefined});
    let j={};try{j=await r.json()}catch{}
    if(!r.ok&&!j.error)j.error=r.status===404?'No Ater chat server at this address.':'The server said '+r.status+'.';
    return j;
  }catch{return{error:'Can’t reach the Ater chat server.'}}
}
/* Ater's own emotes live on the server; the Ater 7TV set comes straight from 7TV's CDN */
function setEmotes(list,b){ATER.emotes=new Map(list.map(e=>[e.name,/^https?:/.test(e.url)?e.url:b+e.url]));ATER.ew=new Map(list.filter(e=>e.w&&e.w!==28).map(e=>[e.name,e.w]))}
function aterTokens(text){
  const out=[];
  for(const w of String(text).split(/(\s+)/)){if(!w)continue;const u=ATER.emotes.get(w);if(u)out.push({url:u,name:w,src:'at',w:ATER.ew.get(w)});else if(typeof out[out.length-1]==='string')out[out.length-1]+=w;else out.push(w)}
  return out;
}
const AT_BADGE={owner:['host','Broadcaster'],mod:['mod','Moderator'],og:['og','OG: one of the first 100 on Ater']};
function aterBadges(b){return(b||[]).map(x=>{if(x.startsWith('streak:')){const n=+x.slice(7);return{p:'at',k:'streak',t:n+'-day chat streak',n}}const d=AT_BADGE[x];return d?{p:'at',k:d[0],t:d[1]}:null}).filter(Boolean)}
function aterMsg(d,hist){
  if(ATER.seen.has(d.id))return;ATER.seen.add(d.id);
  sevMsg('at',CONFIG.sevenTV||'',d.name,d.text,d.color,aterTokens(d.text),aterBadges(d.b),null,d.rp?{n:d.rp.n,t:d.rp.t,id:d.rp.id}:null,{sid:d.id,me:!!d.me,hist:!!hist,ts0:d.ts});
}
function aterStart(){
  const b=aterBase();
  if(b==null){status('at','err','no server');emit('ater','down');return}
  if(ATER.es)ATER.es.close();
  status('at','wait','connecting…');
  const es=ATER.es=new EventSource(b+'/api/stream',{withCredentials:true});
  const L=(ev,f)=>es.addEventListener(ev,e=>{let d;try{d=JSON.parse(e.data)}catch{return}f(d)});
  L('hello',d=>{
    ATER.up=true;ATER.me=d.me;ME=d.me&&d.me.name;mkAR();
    ATER.list=d.emotes||[];setEmotes(ATER.list,b);
    ATER.pins=d.pins||[];ATER.featured=d.featured||null;ATER.poll=d.poll;ATER.pres=d.presence||{n:0,users:[]};ATER.settings=d.settings||{};
    status('at','on',ATER.pres.n+' here');emit('ater','hello');
    for(const m of d.history||[])aterMsg(m,true);
  });
  L('msg',d=>aterMsg(d));
  L('del',d=>emit('aterdel',d.id));
  L('clear',d=>emit('aterclear',d));
  L('pins',d=>{ATER.pins=d||[];emit('ater','pins')});
  L('poll',d=>{ATER.poll=d;emit('ater','poll')});
  L('presence',d=>{ATER.pres=d;status('at','on',d.n+' here');emit('ater','presence')});
  L('emotes',d=>{ATER.list=d;setEmotes(d,b);emit('ater','emotes')});
  L('settings',d=>{ATER.settings=d||{};emit('ater','settings')});
  L('notice',d=>emit('aternotice',d));
  L('whisper',d=>emit('whisper',d));
  L('me',d=>{ATER.me=d.me;ME=d.me&&d.me.name;mkAR();emit('ater','me')});
  L('modqueue',d=>{ATER.reports=d.reports||0;emit('ater','modqueue')});
  L('modlog',d=>emit('modlog',d));
  L('featured',d=>{const was=ATER.featured;ATER.featured=d;emit('ater','featured');emit('featured',{now:d,was})});
  es.onerror=()=>{const dead=es.readyState===2;if(ATER.up||dead){ATER.up=false;status('at',dead?'err':'wait',dead?'offline':'reconnecting…');emit('ater','down')}};
}
on('whisper',d=>{if(ME&&nm(d.from)===nm(ME))return;INBOX.push({id:d.ts+'-w',p:'at',name:d.from,text:d.text,ts:d.ts,r:false,w:true});ibSave();toast('Whisper from '+d.from,d.text);ping()});

const CONNS={tw:Twitch(),kk:Kick(),yt:YouTube()};

/* ---- guest chat: the chat of whatever other streamer you're watching, kept apart from Ater chat ---- */
const GX={guest:true,gch:'',gp:''};
const GUEST={p:'',u:'',conns:{twitch:Twitch('gtw',GX),kick:Kick('gkk',GX)}};
const guestKey=()=>GUEST.p?GUEST.p+':'+GUEST.u:'';
async function guestStart(p,u){
  guestStop(true);
  if(!GUEST.conns[p])return false;
  GUEST.p=p;GUEST.u=String(u).toLowerCase();GX.gch=GUEST.u;GX.gp=p;
  emit('guest',{on:true});
  const ok=await GUEST.conns[p].start(p==='kick'?{ch:GUEST.u,relay:FIELDS.kkrl}:{ch:GUEST.u});
  if(!ok){emit('guest',{on:false,failed:true,p,u:GUEST.u});GUEST.p='';GUEST.u=''}
  return ok;
}
function guestStop(quiet){
  if(!GUEST.p)return;
  GUEST.conns[GUEST.p].stop();const was={p:GUEST.p,u:GUEST.u};GUEST.p='';GUEST.u='';
  if(!quiet)emit('guest',{on:false,was});
}
/* saved connection fields */
const FIELDS=LS.get('fields',{tw:CONFIG.channels.twitch||'',kk:CONFIG.channels.kick||'',kkid:'',kkrl:CONFIG.kickRelay||'',yt:'',ytk:''});
const saveFields=()=>LS.set('fields',FIELDS);
async function connect(p,opts){
  if(opts)Object.assign(FIELDS,opts),saveFields();
  if(ACTIVE[p])CONNS[p].stop();
  const o=p==='tw'?{ch:FIELDS.tw}:p==='kk'?{ch:FIELDS.kk,id:FIELDS.kkid,relay:FIELDS.kkrl}:{ch:FIELDS.yt,key:FIELDS.ytk};
  ACTIVE[p]=true;emit('active');
  const ok=await CONNS[p].start(o);
  ACTIVE[p]=!!ok;emit('active');
  const onL=LS.get('on',{});onL[p]=!!ok;LS.set('on',onL);
  return ok;
}
function disconnect(p){CONNS[p].stop();ACTIVE[p]=false;emit('active');const onL=LS.get('on',{});onL[p]=false;LS.set('on',onL)}

/* =====================================================================
   DERIVED DATA: pulse, history, links, leaderboard, mentions
   ===================================================================== */
/* ---- pulse: rolling per-second counts, chatters, emotes ---- */
const PULSE={sec:new Map(),users:new Map(),emo:new Map()};
const TODAY=Object.assign({d:dayKey(),msgs:0,links:0,peak:0,users:[]},LS.get('today',{}));
if(TODAY.d!==dayKey())Object.assign(TODAY,{d:dayKey(),msgs:0,links:0,peak:0,users:[]});
const todayUsers=new Set(TODAY.users);
function pulseAdd(m){
  const s=Math.floor(m.ts/1000);PULSE.sec.set(s,(PULSE.sec.get(s)||0)+1);
  PULSE.users.set(m.p+':'+nm(m.name),m.ts);
  for(const t of m.toks)if(t&&t.url)PULSE.emo.set(t.name,{url:t.url,n:((PULSE.emo.get(t.name)||{}).n||0)+1,ts:m.ts});
  if(TODAY.d!==dayKey()){Object.assign(TODAY,{d:dayKey(),msgs:0,links:0,peak:0});todayUsers.clear()}
  TODAY.msgs++;TODAY.links+=m.urls.length;todayUsers.add(m.p+':'+nm(m.name));
}
function pulse(){
  const now=Math.floor(Date.now()/1000);let min=0;const bars=new Array(30).fill(0);
  for(const[s,n]of PULSE.sec){const a=now-s;if(a>=300){PULSE.sec.delete(s);continue}if(a<60)min+=n;bars[29-Math.floor(a/10)]+=n}
  let users=0;for(const[k,t]of PULSE.users){if(Date.now()-t>300000)PULSE.users.delete(k);else users++}
  if(min>TODAY.peak)TODAY.peak=min;
  return{min,users,bars};
}
function topEmotes(n=6){
  const now=Date.now();for(const[k,v]of PULSE.emo)if(now-v.ts>3600000)PULSE.emo.delete(k);
  return[...PULSE.emo.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,n);
}
setInterval(()=>{TODAY.users=[...todayUsers].slice(-20000);LS.set('today',TODAY)},10000);

/* ---- history: every message per user (for search + user cards) ---- */
const HIST=[],HIST_MAX=8000;
function histAdd(m){HIST.push({p:m.p,name:m.name,text:m.text,ts:m.ts,color:m.color,ev:m.ev?m.ev.t:'',bds:m.bds});if(HIST.length>HIST_MAX)HIST.splice(0,HIST.length-HIST_MAX)}

/* ---- links queue ---- */
let LINKS=LS.get('links',[]);const OPENED=new Set(LS.get('opened',[]));
const SHORT='bit.ly t.co tinyurl.com goo.gl is.gd cutt.ly ow.ly rb.gy shorturl.at t.ly buff.ly tiny.cc v.gd s.id lnkd.in rebrand.ly'.split(' ');
const GRAB='grabify.link iplogger.org iplogger.com iplogger.ru 2no.co yip.su ipgrabber.ru blasze.com'.split(' ');
const onDom=(h,d)=>h===d||h.endsWith('.'+d);
function risk(u){
  try{const x=new URL(u),host=x.hostname.toLowerCase(),r=[];
    if(GRAB.some(d=>onDom(host,d)))r.push('IP logger');
    else if(SHORT.some(d=>onDom(host,d)))r.push('Short link');
    if(/^xn--|\.xn--/.test(host))r.push('Lookalike domain');
    if(/\.(exe|scr|bat|msi|apk|dmg|zip|rar)$/i.test(x.pathname))r.push('File download');
    return r}catch{return['Bad link']}
}
const LTYPE={youtube:'YouTube',x:'X',clip:'Clip',twitch:'Twitch',kick:'Kick',tiktok:'TikTok',reddit:'Reddit',discord:'Discord',img:'Image',other:'Web'};
function ltype(u){
  try{const x=new URL(u),host=x.hostname.replace(/^www\.|^m\./,'');
    if(/(^|\.)youtube\.com$|^youtu\.be$/.test(host))return'youtube';
    if(/^(x|twitter)\.com$/.test(host))return'x';
    if(host==='clips.twitch.tv'||/\/clip\//.test(x.pathname))return'clip';
    if(/twitch\.tv$/.test(host))return'twitch';
    if(/kick\.com$/.test(host))return'kick';
    if(/tiktok\.com$/.test(host))return'tiktok';
    if(/reddit\.com$|redd\.it$/.test(host))return'reddit';
    if(/discord\.(gg|com)$/.test(host))return'discord';
    if(/\.(png|jpe?g|gif|webp)$/i.test(x.pathname))return'img';
    return'other'}catch{return'other'}
}
let linkSave=0;
function saveLinks(){if(linkSave)return;linkSave=requestAnimationFrame(()=>{linkSave=0;LS.set('links',LINKS.slice(-400));LS.set('opened',[...OPENED].slice(-3000));emit('links')})}
function linkAdd(m){
  if(m.bot||isAlias(m.name))return;
  const ttl=titleOf(m.text);
  for(const url of m.urls){
    if(OPENED.has(url))continue;
    let l=LINKS.find(x=>x.url===url);
    if(!l){l={url,ts:m.ts,title:ttl,senders:[]};LINKS.push(l)}
    if(!l.title&&ttl)l.title=ttl;
    if(!l.senders.some(s=>s.p===m.p&&nm(s.name)===nm(m.name)))l.senders.push({p:m.p,name:m.name,ts:m.ts});
    l.last=m.ts;
  }
  saveLinks();
}
function markOpened(url){OPENED.add(url);LINKS=LINKS.filter(l=>l.url!==url);saveLinks()}

/* ---- leaderboard: per-day buckets, repeats inside 10s ignored ---- */
const LB=LS.get('lb',{}),LBLAST=new Map();let lbDirty=0;
function lbAdd(m){
  if(m.bot||m.ev||isAlias(m.name))return;
  const k=m.p+':'+nm(m.name),last=LBLAST.get(k)||0;LBLAST.set(k,m.ts);
  const d=dayKey(m.ts),b=LB[d]||(LB[d]={}),r=b[k]||(b[k]=[m.name,m.p,0,0]);
  r[0]=m.name;if(m.ts-last>10000)r[2]++;r[3]+=m.urls.length;
  if(!lbDirty)lbDirty=setTimeout(()=>{lbDirty=0;const keys=Object.keys(LB).sort();while(keys.length>400)delete LB[keys.shift()];LS.set('lb',LB);emit('lb')},4000);
}
function lbCalc(per,kind,limit=50){
  const days=per==='day'?1:per==='week'?7:per==='month'?30:1e9,cut=new Date();cut.setHours(0,0,0,0);cut.setDate(cut.getDate()-(days-1));
  const cutK=days>1e6?'':dayKey(cut.getTime()),tot=new Map();
  for(const[d,b]of Object.entries(LB)){if(d<cutK)continue;for(const[k,r]of Object.entries(b)){const n=kind==='links'?r[3]:r[2];if(!n)continue;const t=tot.get(k)||{name:r[0],p:r[1],n:0};t.n+=n;t.name=r[0];tot.set(k,t)}}
  return[...tot.values()].sort((a,b)=>b.n-a.n).slice(0,limit);
}

/* ---- mentions inbox ---- */
let INBOX=LS.get('inbox',[]);
const ibSave=()=>{LS.set('inbox',INBOX.slice(-500));emit('inbox')};
let AC=null;addEventListener('pointerdown',()=>{try{AC=AC||new AudioContext();AC.resume()}catch{}},{once:false,passive:true});
function ping(){if(!SET.sound||!AC)return;try{const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.setValueAtTime(880,AC.currentTime);o.frequency.exponentialRampToValueAtTime(1320,AC.currentTime+.08);g.gain.setValueAtTime(.0001,AC.currentTime);g.gain.exponentialRampToValueAtTime(.18,AC.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,AC.currentTime+.35);o.connect(g).connect(AC.destination);o.start();o.stop(AC.currentTime+.4)}catch{}}
function ibAdd(m){
  if(!m.mention||m.bot)return;
  INBOX.push({id:m.ts+'-'+m.id,p:m.p,name:m.name,text:m.text,ts:m.ts,r:false});ibSave();
  toast('@ '+m.name,m.text);ping();
}

on('msg',m=>{histAdd(m);if(m.hist||m.guest)return;pulseAdd(m);linkAdd(m);lbAdd(m);ibAdd(m)});
