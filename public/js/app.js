/* =====================================================================
   ATER LIVE — UI
   ===================================================================== */
const VIEW=()=>document.body.dataset.view;
const enc=encodeURIComponent;
const isTyping=e=>{const t=e.target;return t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))};
const NAMECOL=['#ff7a90','#ffb86b','#ffe17a','#9be37a','#6fe3c4','#7ad3ff','#8fa8ff','#c79bff','#ff9be0','#f2a07b'];
const colorFor=n=>{let x=0;for(const c of nm(n))x=(x*31+c.charCodeAt(0))|0;return NAMECOL[Math.abs(x)%NAMECOL.length]};
const copy=t=>navigator.clipboard?navigator.clipboard.writeText(t).then(()=>true,()=>false):Promise.resolve(false);
const baseUrl=()=>location.href.split('#')[0].split('?')[0];

/* =====================================================================
   ROUTER   #/  ·  #/bigscreen  ·  #/chat (pop-out)  ·  #/overlay (OBS)
   ===================================================================== */
const OV=document.documentElement.classList.contains('ov');
function route(){
  const hs=location.hash||'#/';let v='home';
  if(OV||/^#\/(chat|overlay)/.test(hs))v='chat';
  else if(/^#\/big/.test(hs))v='big';
  const was=VIEW();document.body.dataset.view=v;
  $$('.nav a[data-r]').forEach(a=>a.classList.toggle('on',a.dataset.r===v));
  $('#top').classList.remove('open');
  const q=new URLSearchParams(hs.split('?')[1]||'');
  if(q.get('s')){embFromParam(q.get('s'));history.replaceState(null,'','#/bigscreen')}
  renderStage();heroSync();syncFab();
  if(v!=='home'){requestAnimationFrame(()=>{if(stick)scr.scrollTop=scr.scrollHeight})}
  if(v==='home'&&was&&was!=='home')scrollTo(0,0);
  document.title=v==='home'?'Ater Live · '+CONFIG.name:v==='big'?'Big Screen · Ater Live':'Chat · Ater Live';
}
addEventListener('hashchange',route);
const go=hash=>{if(location.hash===hash)route();else location.hash=hash};
function scrollToSec(id){const doit=()=>{const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth'})};if(VIEW()!=='home'){go('#/');setTimeout(doit,60)}else doit()}
$$('.nav a[data-s]').forEach(a=>a.onclick=e=>{e.preventDefault();$('#top').classList.remove('open');scrollToSec(a.dataset.s)});

/* =====================================================================
   TOP BAR + CHANNELS SHEET
   ===================================================================== */
addEventListener('scroll',()=>$('#top').classList.toggle('sc',scrollY>4),{passive:true});
$('#menuBtn').onclick=()=>{const t=$('#top'),o=!t.classList.contains('open');t.classList.toggle('open',o);$('#menuBtn').setAttribute('aria-expanded',o)};
{
  const L=CONFIG.links,S=[['twitch','i-tw','Twitch'],['kick','i-kk','Kick'],['youtube','i-yt','YouTube'],['x','i-xs','X'],['discord','i-dc','Discord']];
  const box=$('#socials');for(const[k,ic,t]of S)if(L[k]&&L[k]!=='#'){const a=h('a');a.href=L[k];a.target='_blank';a.rel='noopener';a.title=t;a.setAttribute('aria-label',t);a.append(icon(ic));box.append(a)}
}
function miniHTML(){return'<span class="m at" title="Ater chat"><span class="atb"></span></span><span class="m tw"><svg><use href="#i-tw"/></svg></span><span class="m kk"><svg><use href="#i-kk"/></svg></span><span class="m yt"><svg><use href="#i-yt"/></svg></span>'}
$('#cpMini').innerHTML=miniHTML();$('#hsMini').innerHTML=miniHTML();
const sheet=$('#sheet'),chanBtn=$('#chanBtn');
function setSheet(o,p){sheet.hidden=!o;chanBtn.setAttribute('aria-expanded',o);if(o){pickPt(p||sheet.dataset.p||'tw');setTimeout(()=>{const i=$('#f-'+(sheet.dataset.p||'tw'));if(i&&!i.value)i.focus()},30)}}
chanBtn.onclick=e=>{e.stopPropagation();setSheet(sheet.hidden)};
$('#sheetX').onclick=()=>setSheet(false);
document.addEventListener('pointerdown',e=>{if(!sheet.hidden&&!sheet.contains(e.target)&&!chanBtn.contains(e.target))setSheet(false)});
function pickPt(p){sheet.dataset.p=p;$$('.pt').forEach(b=>b.setAttribute('aria-selected',b.dataset.pt===p));['tw','kk','yt'].forEach(x=>$('#pf-'+x).hidden=x!==p)}
$$('.pt').forEach(b=>b.onclick=()=>pickPt(b.dataset.pt));
const FMAP={'f-tw':'tw','f-kk':'kk','f-kkid':'kkid','f-kkrl':'kkrl','f-yt':'yt','f-ytk':'ytk'};
for(const[id,k]of Object.entries(FMAP)){const el=$('#'+id);el.value=FIELDS[k]||'';el.oninput=()=>{FIELDS[k]=el.value;saveFields();if(k==='kkrl')kickHint()};el.onkeydown=e=>{if(e.key==='Enter'){const b=el.closest('.pf').querySelector('[data-c]');if(b&&!ACTIVE[b.dataset.c])b.click()}}}
$$('[data-c]').forEach(b=>b.onclick=async()=>{const p=b.dataset.c;if(ACTIVE[p]){disconnect(p);return}b.disabled=true;await connect(p);b.disabled=false});
function kickHint(force){$('#kkHint').hidden=force===false||(!force&&!!relayBase(FIELDS.kkrl))}
on('kickhint',v=>{kickHint(v);if(v&&!sheet.hidden)pickPt('kk')});
function syncStatus(){
  for(const p of['tw','kk','yt']){
    const s=STATUS[p];
    $$('.mini .m.'+p).forEach(m=>{m.className='m '+p+' '+s.c;m.title=PN[p]+' · '+s.t});
    const st=$('#st-'+p);st.className='st '+s.c;st.textContent=s.t;
    const pt=$('.pt[data-pt='+p+']');pt.dataset.s=s.c;
    const b=$('[data-c='+p+']');b.textContent=ACTIVE[p]?'Disconnect':'Connect';b.classList.toggle('btn-p',!ACTIVE[p]);b.classList.toggle('btn-o',ACTIVE[p]);
  }
  const sa=STATUS.at;$$('.mini .m.at').forEach(m=>{m.className='m at '+sa.c;m.title='Ater chat · '+sa.t});
  const n=['tw','kk','yt'].filter(p=>STATUS[p].c==='on');
  $('#chanLbl').textContent=n.length?'Ater + '+n.length:'Ater chat';
  const meta=$('#cpMeta');meta.replaceChildren();
  meta.append(h('b',null,'Ater'),ATER.up?' · '+ATER.pres.n+' here':aterBase()==null?' · no server':' · '+sa.t);
  if(n.length){meta.append(' + ');n.forEach((p,i)=>{if(i)meta.append(', ');meta.append(h('b',null,PN[p]+' '+(p==='tw'?'#':'')+CHAN[p]))})}
  const nb=$('#nativeBtn'),np=nativeP();nb.hidden=!np;if(np)nb.textContent=PN[np]+' chat ↗';
  welcome();if(PANE==='set')renderSet();
}
on('status',syncStatus);on('active',syncStatus);

/* =====================================================================
   MESSAGE RENDERING (Ater Chat style)
   ===================================================================== */
const ICONS=new Set(['host','mod','vip','sub','ver','og','founder','gifter','staff']);
function aterBadgeEl(){const s=h('span','atb bd');s.title='Ater chat';return s}
function badgeEl(b){
  if(b.k==='streak'){const s=h('span','bd streak');s.title=b.t;s.append(icon('b-streak'),String(b.n));return s}
  const s=h('span','bd');s.title=b.t;
  const fb=()=>{s.replaceChildren();if(ICONS.has(b.k)){s.className='bd '+b.k+' '+b.p;s.append(icon('b-'+b.k))}else{s.className='bd chip';s.textContent=b.t}};
  if(!b.img){fb();return s}
  const i=new Image();i.alt=b.t;i.referrerPolicy='no-referrer';i.onerror=fb;i.src=b.img;s.append(i);return s;
}
function emoteEl(e){
  if(!e.url){const c=h('span','chip',e.name);return c}
  const i=new Image();i.className='em';i.src=e.url;i.alt=e.name;i.title=e.name;i.referrerPolicy='no-referrer';i.loading='lazy';if(e.w)i.style.width=(e.w/14)+'em';
  if(e.src!=='7tv'){i.onerror=()=>i.replaceWith(e.name);return i}
  const w=h('span','sv'),t=h('span','sv-t',e.name);i.onerror=()=>{i.remove();t.style.display='inline'};w.append(i,t);return w;
}
function anchor(u){const a=h('a',null,u);a.href=u;a.target='_blank';a.rel='noopener noreferrer';a.dataset.u=u;return a}
function linkify(d,s){s.split(/(https:\/\/[^\s<>"'`]+)/gi).forEach((part,i)=>{if(i%2&&validUrl(cleanUrl(part))){const c=cleanUrl(part);d.append(anchor(c),part.slice(c.length))}else if(part)d.append(part)})}
function tagEl(p){const s=h('span','tag '+p);s.title=PN[p];s.append(icon(PI[p]));return s}
const EVI={sub:'b-sub',gift:'b-gifter',cash:'b-vip',raid:'e-raid'};
function nameEl(m){const n=h('b','nm',m.name);n.style.color=m.color||colorFor(m.name);n.dataset.p=m.p;n.dataset.n=m.name;n.title='See everything '+m.name+' said';return n}
function renderMsg(m,o={}){
  const d=h('div','msg');d.dataset.k=m.p+':'+nm(m.name);d.dataset.p=m.p;if(m.sid)d.dataset.sid=m.sid;
  if(m.rp){const r=h('div','rp');r.title=m.rp.n+': '+m.rp.t;if(m.rp.id)r.dataset.to=m.rp.id;r.append(icon('e-reply'));r.append(h('b',null,'@'+m.rp.n),' '+m.rp.t);d.append(r)}
  if(o.ts!==false)d.append(h('span','ts',clock(m.ts)));
  if(m.p==='at')d.append(aterBadgeEl());else d.append(tagEl(m.p));
  let body=d;const n=nameEl(m);
  if(m.ev){
    d.classList.add('ev',m.p);
    const i=h('span','evi');i.append(icon(EVI[m.ev.k]||'b-sub'));
    d.append(i,n,h('span','evh',' '+m.ev.t));
    if(m.text){body=h('div','evm');d.append(body)}
  }else{
    for(const b of m.bds||[])d.append(badgeEl(b));
    if(m.me){d.classList.add('me');body=h('span','mt');body.style.color=m.color||colorFor(m.name);d.append(n,' ',body)}
    else d.append(n,': ');
  }
  if(!m.ev||m.text)for(const t of m.toks){if(typeof t==='string')linkify(body,t);else body.append(emoteEl(t))}
  if(m.urls.length)d.classList.add('hl');
  if(m.mention)d.classList.add('mn');
  if(m.p==='at'&&ME&&nm(m.name)===nm(ME))d.classList.add('own');
  return d;
}
document.addEventListener('click',e=>{
  const a=e.target.closest('a[data-u]');if(a)setTimeout(()=>markOpened(a.dataset.u),150);
  const n=e.target.closest('.nm[data-n]');if(n){if(VIEW()==='home'){go('#/bigscreen');setTimeout(()=>userCard(n.dataset.p,n.dataset.n),80)}else userCard(n.dataset.p,n.dataset.n)}
});

/* =====================================================================
   MAIN FEED
   ===================================================================== */
const feed=$('#feed'),scr=$('#chatScroll'),jump=$('#jump');
let stick=true,unread=0,pend=[],raf=0;
function applySet(){
  feed.classList.toggle('nots',!SET.ts);feed.classList.toggle('nologo',!SET.logos);feed.classList.toggle('nobadge',!SET.badges);feed.classList.toggle('nosv',!SET.sv);
  const mf=$('#miniFeed');mf.classList.toggle('nosv',!SET.sv);mf.classList.toggle('nologo',!SET.logos);mf.classList.toggle('nobadge',!SET.badges);
  const q=new URLSearchParams(location.search);const fs=OV&&q.get('size')?+q.get('size'):SET.fs;
  feed.style.setProperty('--cfs',fs+'px');
}
on('set',applySet);
function syncJump(){jump.classList.toggle('show',!stick);$('#jumpT').textContent=unread?unread+' new message'+(unread>1?'s':''):'Jump to present'}
scr.addEventListener('scroll',()=>{const s=scr.scrollHeight-scr.scrollTop-scr.clientHeight<48;if(s!==stick||(s&&unread)){stick=s;if(s)unread=0;syncJump()}},{passive:true});
jump.onclick=()=>{stick=true;unread=0;scr.scrollTop=scr.scrollHeight;syncJump()};
on('msg',m=>{if(SET.nobots&&m.bot)return;pend.push(m);if(!raf)raf=requestAnimationFrame(flush)});
function flush(){
  raf=0;if(!pend.length)return;
  const w=$('#welcome');if(w)w.remove();
  const list=pend.slice(-200),fr=document.createDocumentFragment();pend=[];
  for(const m of list){
    const e=SET.combos&&!m.hist&&soloEmote(m),prev=fr.lastChild||feed.lastElementChild;
    if(e&&prev&&prev.dataset.emo===e.name){comboBump(prev,m,e);continue}
    const el=renderMsg(m);if(e){el.dataset.emo=e.name;el._who=[m.name]}
    if(OV)ovFade(el);fr.append(el);
  }
  feed.append(fr);
  /* keep the window light, but drop platform messages before Ater ones so a busy Twitch chat can't bury Ater chat */
  if(feed.children.length>400){let ex=feed.children.length-400;for(const el of feed.querySelectorAll('.msg:not([data-p="at"])')){if(ex--<=0)break;el.remove()}while(feed.children.length>700)feed.firstChild.remove()}
  if(stick)scr.scrollTop=scr.scrollHeight;else{unread+=list.length;syncJump()}
}
/* dgg-style combos: the same lone emote sent back to back stacks into one C-C-C-COMBO line */
function soloEmote(m){if(m.ev||m.me||m.rp)return null;let e=null;for(const t of m.toks){if(typeof t==='string'){if(t.trim())return null}else{if(e||!t.url)return null;e=t}}return e}
function comboBump(prev,m,e){
  let c=prev;
  if(!c.classList.contains('combo')){c=h('div','msg combo');c.dataset.emo=e.name;c._who=prev._who||[];c._n=1;c.append(emoteEl(e),h('span','cx'),h('span','ct','C-C-C-COMBO'));prev.replaceWith(c)}
  c._n++;c._who.push(m.name);
  c.querySelector('.cx').textContent='×'+c._n;c.title=[...new Set(c._who)].slice(-25).join(', ');
  c.classList.toggle('big',c._n>=10);c.classList.remove('bump');void c.offsetWidth;c.classList.add('bump');
}
/* ---- Ater chat events in the feed ---- */
function markDeleted(el){el.classList.add('del');el.removeAttribute('data-emo');const n=el.querySelector('.nm');if(!n)return el.remove();const rp=el.querySelector('.rp');if(rp)rp.remove();el.querySelectorAll('.ma').forEach(x=>x.remove());while(n.nextSibling)n.nextSibling.remove();n.after(h('span','txt',' message deleted'))}
on('aterdel',id=>$$('.msg[data-sid="'+CSS.escape(id)+'"]').forEach(markDeleted));
on('aterclear',d=>{$$('#feed .msg[data-p="at"],#miniFeed .msg[data-p="at"]').forEach(e=>e.remove());sys('Chat was cleared'+(d&&d.by?' by <b>'+escH(d.by)+'</b>':'')+'.','sys')});
on('aternotice',d=>sys(escH(d.text),'sys'));
on('whisper',d=>{
  const mine=ME&&nm(d.from)===nm(ME),el=h('div','msg wh');
  el.append(h('span','whl',mine?'Whisper to':'Whisper'));
  const n=h('b','nm',mine?d.to:d.from);n.style.color=colorFor(mine?d.to:d.from);n.dataset.p='at';n.dataset.n=mine?d.to:d.from;el.append(n,': ');
  const b=h('span');for(const t of aterTokens(d.text)){if(typeof t==='string')linkify(b,t);else b.append(emoteEl(t))}el.append(b);
  const w=$('#welcome');if(w)w.remove();feed.append(el);if(stick)scr.scrollTop=scr.scrollHeight;
});
/* hover actions on Ater messages: reply, and for mods pin / delete / mute */
feed.addEventListener('mouseover',e=>{
  const m=e.target.closest('.msg[data-sid]');if(!m||m.querySelector('.ma')||m.classList.contains('del')||!ATER.me)return;
  const bar=h('div','ma');const add=(a,ic,t,cls)=>{const b=h('button',cls||'');b.dataset.a=a;b.title=t;b.setAttribute('aria-label',t);b.append(icon(ic));bar.append(b)};
  add('reply','e-reply','Reply');
  if(ATER.me.mod){add('pin','i-pin','Pin for everyone');add('mute','i-mute','Mute for 10 minutes','danger');add('del','i-trash','Delete','danger')}
  m.append(bar);
});
feed.addEventListener('click',async e=>{
  const rp=e.target.closest('.rp[data-to]');if(rp){const t=feed.querySelector('.msg[data-sid="'+CSS.escape(rp.dataset.to)+'"]');if(t){t.scrollIntoView({block:'center',behavior:'smooth'});t.classList.remove('flash');void t.offsetWidth;t.classList.add('flash')}return}
  const b=e.target.closest('.ma button');if(!b)return;
  const m=b.closest('.msg'),sid=m.dataset.sid,name=m.querySelector('.nm')&&m.querySelector('.nm').dataset.n;
  let r;
  if(b.dataset.a==='reply'){const txt=[...m.childNodes].filter(x=>!(x.classList&&(x.classList.contains('ma')||x.classList.contains('rp')||x.classList.contains('ts')||x.classList.contains('bd')||x.classList.contains('nm')))).map(x=>x.textContent).join('').replace(/^:\s*/,'').trim();setReply({sid,name,text:txt});return}
  if(b.dataset.a==='pin')r=await aterApi('/api/pin',{id:sid});
  if(b.dataset.a==='del')r=await aterApi('/api/del',{id:sid});
  if(b.dataset.a==='mute')r=await aterApi('/api/send',{text:'/mute '+name+' 10m'});
  if(r&&r.error)sys(escH(r.error),'sys');
});
function sys(html,cls='cmd'){const w=$('#welcome');if(w)w.remove();const d=h('div','msg '+cls);d.innerHTML=html;feed.append(d);if(stick)scr.scrollTop=scr.scrollHeight;return d}
function ovFade(el){const s=+(new URLSearchParams(location.search).get('fade')||30);if(s>0)setTimeout(()=>{el.classList.add('old');setTimeout(()=>el.remove(),700)},s*1000)}
on('purge',x=>{$$('#feed .msg[data-k="'+x.p+':'+nm(x.name)+'"]').forEach(e=>e.classList.add('dim'))});
function welcome(){
  if(feed.querySelector('.msg'))return;
  let w=$('#welcome');if(!w){w=h('div','welcome');w.id='welcome';feed.append(w)}
  w.innerHTML='<span class="logo" aria-hidden="true"></span>';
  const a=h('div','acts');
  const plat=()=>{for(const p of['tw','kk','yt']){const b=h('button','btn btn-o btn-sm');b.append(pmark(p),'Show '+PN[p]+' chatters');b.onclick=()=>setPlatform(p,true);a.append(b)}};
  if(aterBase()==null){
    w.append(h('h3',null,'Ater chat runs on its own server'),h('p',null,'Start it with node ater-server.js, then open http://localhost:8080. Meanwhile you can still read the platform chats.'));plat();
  }else if(!ATER.up){
    w.append(h('h3',null,STATUS.at.c==='err'?'Ater chat is offline':'Connecting to Ater chat…'),h('p',null,STATUS.at.c==='err'?'The Ater chat server isn’t answering. It reconnects by itself as soon as it’s back.':'One moment.'));
  }else{
    w.append(h('h3',null,'Welcome to Ater chat'),h('p',null,ATER.me?'It’s quiet in here. Say something, try an emote like AterW, or type / to see what you can do.':'This is where '+CONFIG.name+'’s chat lives. Sign in to talk, or switch on Twitch, Kick and YouTube chatters in settings to see them here too.'));
    if(!ATER.me){const b=h('button','btn btn-p btn-sm','Sign in to chat');b.onclick=()=>openAuth('login');a.append(b)}
  }
  w.append(a);
}

/* ---- home mini feed ---- */
const mini=$('#miniFeed');
on('msg',m=>{if(m.bot)return;$('#miniEmpty').hidden=true;mini.append(renderMsg(m,{ts:false}));while(mini.children.length>19)mini.children[1].remove()});

/* =====================================================================
   PANES: links · leaderboard · mentions · search · settings · user card
   ===================================================================== */
let PANE='chat';
function pane(p){
  PANE=p;$$('#cpTabs button').forEach(b=>b.classList.toggle('on',b.dataset.p===p));$('#setBtn').classList.toggle('on',p==='set');$('#srBtn').classList.toggle('on',p==='search');
  for(const x of['chat','links','board','inbox','search','set','users'])$('#p-'+x).hidden=x!==p;
  $('#usersBtn').classList.toggle('on',p==='users');
  $('#ucard').hidden=true;
  if(p==='links')renderLinks();if(p==='board')renderBoard();if(p==='inbox')renderInbox();if(p==='set')renderSet();if(p==='users')renderUsers();
  if(p==='search')setTimeout(()=>$('#srQ').focus(),20);
  if(p==='chat'&&stick)scr.scrollTop=scr.scrollHeight;
  if(VIEW()==='big'&&$('#v-big').dataset.chat==='off')setChat(true);
}
$$('#cpTabs button').forEach(b=>b.onclick=()=>pane(b.dataset.p));

/* ---- links ---- */
const lkType=$('#lkType'),lkSort=$('#lkSort');lkSort.value=LS.get('lkSort','new');
lkType.onchange=renderLinks;lkSort.onchange=()=>{LS.set('lkSort',lkSort.value);renderLinks()};
function sortedLinks(){
  const t=lkType.value;let l=LINKS.filter(x=>t==='all'||ltype(x.url)===t);
  const s=lkSort.value;
  l.sort(s==='most'?(a,b)=>b.senders.length-a.senders.length||b.last-a.last:s==='old'?(a,b)=>a.ts-b.ts:(a,b)=>(b.last||b.ts)-(a.last||a.ts));
  return l;
}
function renderLinks(){
  const n=LINKS.length;$('#lkN').textContent=n>99?'99+':n;$('#lkN').className='cnt'+(n?'':' dim');
  if(PANE!=='links')return;
  const types=[...new Set(LINKS.map(x=>ltype(x.url)))],cur=lkType.value;
  lkType.replaceChildren(new Option('All links ('+n+')','all'),...types.map(t=>new Option(LTYPE[t]+' ('+LINKS.filter(x=>ltype(x.url)===t).length+')',t)));lkType.value=types.includes(cur)?cur:'all';
  const ul=$('#lkList');ul.replaceChildren();
  const l=sortedLinks();
  if(!l.length){ul.append(h('li','empty','No links yet. Any https link posted in chat lands here, with who sent it.'));return}
  for(const x of l.slice(0,200)){
    const li=h('li','lk');
    if(x.title)li.append(h('div','ttl',x.title));
    const u=h('div','u');u.append(anchor(x.url));li.append(u);
    const who=h('div','who');who.append(h('span','ty',LTYPE[ltype(x.url)]));
    for(const r of risk(x.url))who.append(h('span','risk',r));
    x.senders.slice(0,3).forEach(s=>{const sp=h('span');sp.style.display='inline-flex';sp.style.gap='4px';sp.style.alignItems='center';sp.append(pmark(s.p),s.name);who.append(sp)});
    if(x.senders.length>3)who.append('+'+(x.senders.length-3)+' more');
    who.append(' · '+ago(x.last||x.ts));li.append(who);
    const ac=h('div','ac2'),xb=h('button','x','✕');xb.title='Dismiss';xb.onclick=()=>markOpened(x.url);ac.append(xb);li.append(ac);
    ul.append(li);
  }
}
on('links',renderLinks);
function openNext(){
  const l=sortedLinks()[0];
  if(!l){toast('Link queue is empty','Links posted in chat show up in the Links tab.');return}
  const r=risk(l.url);if(r.length&&!confirm(r.join(', ')+'\n\n'+l.url+'\n\nOpen it anyway?'))return;
  window.open(l.url,'_blank','noopener');markOpened(l.url);toast('Opened',l.title||l.url);
}
$('#lkNext').onclick=openNext;
$('#lkClr').onclick=()=>{if(!LINKS.length||confirm('Clear all '+LINKS.length+' links from the queue?')){LINKS.forEach(l=>OPENED.add(l.url));LINKS=[];saveLinks()}};

/* ---- leaderboard ---- */
const LBS={k:LS.get('lbk','chat'),r:LS.get('lbr','day')};
function segInit(id,attr,val,cb){$$('#'+id+' button').forEach(b=>{b.classList.toggle('on',b.dataset[attr]===val);b.onclick=()=>{$$('#'+id+' button').forEach(x=>x.classList.toggle('on',x===b));cb(b.dataset[attr])}})}
segInit('lbKind','k',LBS.k,v=>{LBS.k=v;LS.set('lbk',v);renderBoard()});
segInit('lbPer','r',LBS.r,v=>{LBS.r=v;LS.set('lbr',v);renderBoard()});
function boardList(ol,rows,max){
  ol.replaceChildren();
  if(!rows.length){ol.append(h('li','empty','Nobody yet. The board fills up as people chat.'));return}
  const top=rows[0].n;
  for(const r of rows.slice(0,max)){
    const li=h('li');li.append(pmark(r.p));const n=h('span','nm',r.name);n.style.color=colorFor(r.name);li.append(n);
    const bar=h('span','bar-m'),i=h('i');i.style.width=Math.max(4,r.n/top*100)+'%';bar.append(i);li.append(bar,h('span','n',r.n.toLocaleString()));
    li.onclick=()=>{if(VIEW()==='home')go('#/bigscreen');setTimeout(()=>userCard(r.p,r.name),60)};
    ol.append(li);
  }
}
function renderBoard(){
  if(PANE!=='board')return;
  const rows=lbCalc(LBS.r,LBS.k,100);
  $('#lbMeta').textContent=rows.length?rows.length+(rows.length>=100?'+':'')+' '+(LBS.k==='links'?'people sharing links':'chatters')+' · '+{day:'today',week:'last 7 days',month:'last 30 days',all:'all time'}[LBS.r]+' · repeats within 10s are ignored':'';
  boardList($('#lbList'),rows,100);
}
on('lb',()=>{renderBoard();renderCommunity()});

/* ---- mentions ---- */
let ibF='all';
segInit('ibF','f','all',v=>{ibF=v;renderInbox()});
function renderInbox(){
  const un_=INBOX.filter(x=>!x.r).length,b=$('#ibN');b.hidden=!un_;b.textContent=un_>99?'99+':un_;
  if(PANE!=='inbox')return;
  const ul=$('#ibList');ul.replaceChildren();
  const l=INBOX.filter(x=>ibF==='all'||!x.r).slice().reverse();
  if(!l.length){ul.append(h('li','empty',ibF==='un'?'All caught up.':'Messages that mention '+(SET.alias||[]).map(a=>'@'+a).join(' or ')+' land here.'));return}
  for(const x of l.slice(0,300)){
    const li=h('li',x.r?'':'un'),hd=h('div','h');hd.append(pmark(x.p),h('b',null,x.name));if(x.w)hd.append(h('span','pill','Whisper'));hd.append(h('span','sp'),ago(x.ts));li.append(hd);
    const t=h('div');linkify(t,x.text);li.append(t);
    li.onclick=e=>{if(e.target.closest('a'))return;x.r=true;ibSave();if(x.w){pane('chat');cpIn.value='/w '+x.name+' ';cpIn.focus()}else userCard(x.p,x.name)};
    ul.append(li);
  }
}
on('inbox',renderInbox);
$('#ibRead').onclick=()=>{INBOX.forEach(x=>x.r=true);ibSave()};
$('#ibClr').onclick=()=>{if(confirm('Clear all mentions?')){INBOX=[];ibSave()}};

/* ---- search ---- */
const srQ=$('#srQ');let srT=0;
$('#srBtn').onclick=()=>pane(PANE==='search'?'chat':'search');
$('#setBtn').onclick=()=>pane(PANE==='set'?'chat':'set');
$('#srX').onclick=()=>pane('chat');
srQ.oninput=()=>{clearTimeout(srT);srT=setTimeout(runSearch,120)};
function runSearch(){
  const L=$('#srL');L.replaceChildren();
  const raw=srQ.value.trim();
  if(!raw){L.append(h('div','empty','Search the last '+HIST.length.toLocaleString()+' messages. Try a word, or from:name.'));return}
  let from='';const words=[];raw.split(/\s+/).forEach(w=>{const m=w.match(/^from:(.+)$/i);if(m)from=nm(m[1]);else words.push(w)});
  const re=words.length?new RegExp('('+words.map(escRe).join('|')+')','gi'):null;
  let n=0;
  for(let i=HIST.length-1;i>=0&&n<200;i--){
    const r=HIST[i];if(from&&!nm(r.name).includes(from))continue;
    if(re){re.lastIndex=0;if(!re.test(r.text)&&!re.test(r.name))continue}
    n++;const d=h('div','sr-r'),hd=h('div','h');hd.append(pmark(r.p));const b=h('b',null,r.name);b.style.color=r.color||colorFor(r.name);hd.append(b,clock(r.ts));d.append(hd);
    const t=h('div');if(re){re.lastIndex=0;let last=0;for(const m of r.text.matchAll(re)){t.append(r.text.slice(last,m.index),h('mark',null,m[0]));last=m.index+m[0].length}t.append(r.text.slice(last))}else t.textContent=r.text;
    d.append(t);d.onclick=()=>userCard(r.p,r.name);L.append(d);
  }
  if(!n)L.append(h('div','empty','Nothing matches “'+raw+'”.'));
}
function openSearch(q){pane('search');if(q!=null){srQ.value=q;runSearch()}}

/* ---- user card ---- */
function profileUrl(p,n){return p==='tw'?'https://www.twitch.tv/'+nm(n):p==='kk'?'https://kick.com/'+nm(n):''}
function userCard(p,name){
  if(VIEW()==='home')return;
  if(VIEW()==='big'&&$('#v-big').dataset.chat==='off')setChat(true);
  const k=nm(name),rows=HIST.filter(r=>r.p===p&&nm(r.name)===k);
  const c=$('#ucard');c.hidden=false;c.replaceChildren();
  const hd=h('div','uc-h');hd.append(pmark(p));
  const last=rows[rows.length-1];if(last)for(const b of last.bds||[])hd.append(badgeEl(b));
  const b=h('b',null,name);b.style.color=(last&&last.color)||colorFor(name);hd.append(b);
  const pu=profileUrl(p,name);if(pu){const a=h('a','ic');a.href=pu;a.target='_blank';a.rel='noopener';a.title='Open profile';a.append(icon('i-pop'));hd.append(a)}
  const s=h('button','ic');s.title='Search their messages';s.append(icon('i-search'));s.onclick=()=>openSearch('from:'+k);hd.append(s);
  const x=h('button','ic');x.title='Close';x.append(icon('i-x'));x.onclick=()=>c.hidden=true;hd.append(x);
  if(p==='at'&&ATER.me&&nm(name)!==nm(ME)){
    const acts=h('div','uc-s');acts.style.gap='6px';acts.style.flexWrap='wrap';
    const ab=(t,f,cls)=>{const b=h('button','btn btn-sm '+(cls||'btn-o'),t);b.onclick=f;acts.append(b)};
    ab('Whisper',()=>{c.hidden=true;cpIn.value='/w '+name+' ';cpIn.focus()});
    ab('Mention',()=>{c.hidden=true;cpIn.value=(cpIn.value?cpIn.value.replace(/\s*$/,' '):'')+'@'+name+' ';cpIn.focus()});
    if(ATER.me.mod){
      const modc=async t=>{const r=await aterApi('/api/send',{text:t});sys(escH(r.error||r.info||'Done.'),'sys')};
      ab('Mute 10m',()=>modc('/mute '+name+' 10m'));ab('Purge',()=>modc('/purge '+name));
      ab('Ban',()=>{if(confirm('Ban '+name+' from Ater chat?'))modc('/ban '+name)},'btn-o danger');
      if(ATER.me.owner)ab('Make mod',()=>modc('/mod '+name));
    }
    setTimeout(()=>c.insertBefore(acts,c.querySelector('.uc-l')),0);
  }
  const st=h('div','uc-s');
  const lb=lbCalc('all','chat',1e6).find(r=>r.p===p&&nm(r.name)===k);
  st.innerHTML='<div><b>'+rows.length+'</b>this session</div><div><b>'+(lb?lb.n.toLocaleString():0)+'</b>all time</div><div><b>'+rows.reduce((a,r)=>a+extract(r.text).length,0)+'</b>links</div>';
  const ig=h('button','btn btn-sm btn-o',isIgn(name)?'Unignore':'Ignore');ig.style.marginLeft='auto';ig.style.alignSelf='center';
  ig.onclick=()=>{const n2=nm(name);SET.ign=isIgn(name)?SET.ign.filter(x=>x!==n2):[...SET.ign,n2];saveSet();ig.textContent=isIgn(name)?'Unignore':'Ignore';toast(isIgn(name)?'Ignoring '+name:'Showing '+name+' again',isIgn(name)?'Left out of chat, links and the leaderboard.':'')};st.append(ig);
  const l=h('div','uc-l');
  if(!rows.length)l.append(h('div','empty','Nothing from '+name+' since this page opened.'));
  for(const r of rows.slice(-150)){const d=h('div','msg');d.append(h('span','ts',clock(r.ts)));if(r.ev)d.append(h('span','evh',r.ev+' '));linkify(d,r.text);l.append(d)}
  c.append(hd,st,l);requestAnimationFrame(()=>l.scrollTop=l.scrollHeight);
}

/* ---- settings ---- */
function renderSet(){
  const s=$('#set');s.replaceChildren();
  const sec=t=>{const x=h('section');x.append(h('h4',null,t));s.append(x);return x};
  const sw=(box,label,key)=>{const l=h('label','sw-row');const i=h('input','sw');i.type='checkbox';i.checked=!!SET[key];i.onchange=()=>{SET[key]=i.checked;saveSet()};l.append(h('span',null,label),i);box.append(l)};
  let x=sec('Your Ater account');
  if(aterBase()==null){const n=h('div','note');n.innerHTML='Ater chat runs on <code>ater-server.js</code>. Start it with <code>node ater-server.js</code> and open <code>http://localhost:8080</code> to chat.';x.append(n)}
  else if(!ATER.me){const r=h('div','row2');r.append(h('span',null,'Not signed in.'));const b1=h('button','btn btn-p btn-sm','Sign in');b1.onclick=()=>openAuth('login');const b2=h('button','btn btn-o btn-sm','Create account');b2.onclick=()=>openAuth('register');r.append(b1,b2);x.append(r)}
  else{const r=h('div','row2');const av=h('span','av',ME[0]);av.style.background=ATER.me.color||colorFor(ME);r.append(av,h('b',null,ME),h('span',null,ATER.me.owner?'· Broadcaster':ATER.me.mod?'· Moderator':''));const sp=h('span');sp.style.flex='1';r.append(sp);const o=h('button','btn btn-o btn-sm','Sign out');o.onclick=signOut;r.append(o);x.append(r);x.append(swatches())}
  x=sec('Who you see in chat');
  const src=(p,label,sub,checked,onchg,dis)=>{const l=h('label','sw-row src');const nm2=h('span','nm2');nm2.append(label);if(sub)nm2.append(h('small',null,sub));const i=h('input','sw');i.type='checkbox';i.checked=checked;i.disabled=!!dis;i.onchange=()=>onchg(i.checked);l.append(pmark(p),nm2,i);x.append(l)};
  src('at','Ater chatters','Always on: people chatting here, with the Ater badge',true,()=>{},true);
  src('tw','Twitch chatters',FIELDS.tw?'#'+FIELDS.tw:'Pick a channel first',ACTIVE.tw,v=>setPlatform('tw',v));
  src('kk','Kick chatters',FIELDS.kk?FIELDS.kk+(relayBase(FIELDS.kkrl)?'':' · needs a relay'):'Pick a channel first',ACTIVE.kk,v=>setPlatform('kk',v));
  src('yt','YouTube chatters',FIELDS.yt&&FIELDS.ytk?'Live chat via your API key':'Needs a live URL and API key',ACTIVE.yt,v=>setPlatform('yt',v));
  {const r=h('div','xr');r.style.marginTop='6px';const b=h('button','btn btn-o btn-sm','Change channels…');b.onclick=()=>setSheet(true);r.append(b);x.append(r)}
  x=sec('Chat display');
  sw(x,'Badges (Ater, mod, sub…)','badges');sw(x,'Platform logos','logos');sw(x,'Emote combos','combos');sw(x,'Timestamps','ts');sw(x,'7TV emotes','sv');sw(x,'Hide bots and !commands','nobots');
  const fl=h('label','sw-row');const fv=h('span',null,'Text size · '+SET.fs+'px');const fr=h('input');fr.type='range';fr.min=10;fr.max=32;fr.value=SET.fs;fr.style.maxWidth='150px';fr.oninput=()=>{SET.fs=+fr.value;fv.textContent='Text size · '+SET.fs+'px';saveSet()};fl.append(fv,fr);x.append(fl);
  x=sec('Mentions');sw(x,'Play a sound','sound');
  x.append(h('p','hint','Your names, separated by commas. Mentioning any of them lands in Mentions; you are left off the leaderboard.'));
  const al=h('textarea');al.value=(SET.alias||[]).join(', ');al.style.marginTop='8px';al.onchange=()=>{SET.alias=[...new Set(al.value.split(/[\s,]+/).map(nm).filter(Boolean))];saveSet()};x.append(al);
  x=sec('Ignore list');x.append(h('p','hint','Bots and anyone else to leave out of chat, the link queue and the leaderboard.'));
  const ig=h('textarea');ig.value=SET.ign.join(', ');ig.style.marginTop='8px';ig.onchange=()=>{SET.ign=[...new Set(ig.value.split(/[\s,]+/).map(nm).filter(Boolean))];saveSet()};x.append(ig);
  if(ATER.me&&ATER.me.mod){
    x=sec('Moderation');
    const r=h('div','row2');r.append(h('span',null,'Slow mode'));const sel=h('select');[['0','Off'],['3','3s'],['5','5s'],['10','10s'],['30','30s'],['60','1 min']].forEach(([v,t])=>sel.append(new Option(t,v)));sel.value=String(ATER.settings.slow||0);if(sel.selectedIndex<0)sel.append(new Option(ATER.settings.slow+'s',ATER.settings.slow)),sel.value=String(ATER.settings.slow);
    sel.onchange=async()=>{const q=await aterApi('/api/send',{text:'/slow '+(sel.value==='0'?'off':sel.value)});if(q.error)sys(escH(q.error),'sys')};r.append(sel);
    const pb=h('button','btn btn-o btn-sm');pb.append(icon('i-poll','i'),'Start a poll');pb.onclick=openPoll;
    const cb=h('button','btn btn-o btn-sm','Clear chat for everyone');cb.onclick=async()=>{if(confirm('Clear Ater chat for everyone?')){const q=await aterApi('/api/send',{text:'/clear'});if(q.error)sys(escH(q.error),'sys')}};
    r.append(pb,cb);x.append(r);
    x.append(h('p','hint','Hover any Ater message to reply, pin, mute or delete. Commands: /poll, /pin, /mute, /ban, /purge, /slow, /clear'+(ATER.me.owner?', /mod, /unmod':'')+'.'));
    x=sec('Ater emotes');
    const up=h('div','row2');const en=h('input');en.type='text';en.placeholder='EmoteName';en.maxLength=24;const ef=h('input');ef.type='file';ef.accept='image/png,image/gif,image/webp';ef.style.maxWidth='190px';
    const ea=h('button','btn btn-p btn-sm','Add');ea.onclick=()=>{const f=ef.files[0];if(!f||!en.value.trim())return toast('Add a name and an image','PNG, GIF or WebP, under 300 KB.');const fr2=new FileReader();fr2.onload=async()=>{const q=await aterApi('/api/emote',{name:en.value.trim(),data:fr2.result});if(q.error)toast('Couldn’t add it',q.error);else{en.value='';ef.value=''}};fr2.readAsDataURL(f)};
    up.append(en,ef,ea);x.append(up);
    const el=h('div','emo-list');for(const e of ATER.list||[]){const s2=h('span');const im=new Image();im.src=ATER.emotes.get(e.name);im.alt=e.name;s2.append(im,e.name);if(!e.b){const rb=h('button',null,'✕');rb.title='Remove '+e.name;rb.onclick=async()=>{if(confirm('Remove '+e.name+'?')){const q=await aterApi('/api/send',{text:'/emote remove '+e.name});if(q.error)toast('Couldn’t remove it',q.error)}};s2.append(rb)}el.append(s2)}x.append(el);
  }
  x=sec('Tools');const xr=h('div','xr');
  const btn=(t,f)=>{const b=h('button','btn btn-o btn-sm',t);b.onclick=f;xr.append(b)};
  btn('Copy OBS overlay link',copyOverlay);btn('Pop out chat',popout);
  btn('Export leaderboard CSV',()=>{const rows=lbCalc('all','chat',1e6);dl('ater-leaderboard-'+dayKey()+'.csv','\ufeffPlatform,Name,Messages\r\n'+rows.map(r=>[PN[r.p],r.name,r.n].map(csv).join(',')).join('\r\n'),'text/csv')});
  x.append(xr);
  x=sec('Data');const xr2=h('div','xr');x.append(h('p','hint','Everything Ater keeps (links, mentions, leaderboard, settings) is stored in this browser only.'),xr2);
  const b2=h('button','btn btn-o btn-sm','Reset leaderboard');b2.onclick=()=>{if(confirm('Reset the leaderboard for every time range?')){for(const k in LB)delete LB[k];LS.set('lb',LB);emit('lb')}};
  const b3=h('button','btn btn-o btn-sm','Forget everything');b3.style.color='var(--bad)';b3.onclick=()=>{if(confirm('Delete every link, mention, leaderboard entry and setting Ater has saved here?')){Object.keys(localStorage).filter(k=>k.startsWith('ater:')).forEach(k=>localStorage.removeItem(k));location.reload()}};
  xr2.append(b2,b3);
}
const csv=v=>{v=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return/[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
function dl(name,txt,type){const a=h('a');a.href=URL.createObjectURL(new Blob([txt],{type}));a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function copyOverlay(){const u=baseUrl()+'?overlay&size=20&fade=30';copy(u).then(ok=>toast(ok?'Overlay link copied':'Overlay link',ok?'Add it as a Browser Source in OBS. size= and fade= are adjustable.':u,5000))}
function popout(){window.open(baseUrl()+'#/chat','ater-chat','popup,width=440,height=780')}
$('#popBtn').onclick=popout;$('#footPop').onclick=e=>{e.preventDefault();popout()};$('#footOv').onclick=e=>{e.preventDefault();copyOverlay()};

/* =====================================================================
   CHAT INPUT: commands, autocomplete, emotes, native-chat bridge
   ===================================================================== */
const cpIn=$('#cpIn'),acBox=$('#ac');
/* [command, args, what it does, group]   group: a = Ater chat, m = moderators, o = broadcaster */
const CMDS=[
  ['/me','action','Say it in italics','a'],['/w','name message','Whisper to someone on Ater','a'],['/color','#hex | reset','Pick your name colour','a'],['/vote','number','Vote in the running poll','a'],
  ['/embed','[platform] name','Watch a stream on the big screen'],['/unembed','[platform] name','Take a stream off'],['/main','[platform] name','Move a stream to the main screen'],
  ['/embeds','','List what is on the big screen'],['/clearembeds','','Remove every stream'],
  ['/connect','twitch|kick|youtube channel','Mix in a platform’s chatters'],['/disconnect','[platform]','Stop showing a platform’s chatters'],
  ['/search','text','Search chat'],['/next','','Open the next link in the queue'],['/user','name','Show everything someone said'],
  ['/theater','','Theater mode'],['/swap','','Swap chat to the other side'],['/size','10–32','Chat text size'],
  ['/cls','','Clear this window (just for you)'],['/popout','','Pop the chat out'],['/overlay','','Copy the OBS overlay link'],['/help','','Every command'],
  ['/poll','[secs] Question? A | B','Start a poll','m'],['/endpoll','','End the poll now','m'],['/pin','text','Pin a note above chat','m'],['/unpin','','Remove all pins','m'],
  ['/mute','name [10m]','Mute someone','m'],['/unmute','name','Unmute','m'],['/ban','name [reason]','Ban from Ater chat','m'],['/unban','name','Unban','m'],
  ['/purge','name','Delete someone’s recent messages','m'],['/slow','seconds | off','Slow mode','m'],['/clear','','Clear chat for everyone','m'],['/emote','remove Name','Remove an Ater emote','m'],
  ['/mod','name','Make someone a moderator','o'],['/unmod','name','Remove a moderator','o']
];
const cmdOK=c=>!c[3]||c[3]==='a'||(c[3]==='m'&&ATER.me&&ATER.me.mod)||(c[3]==='o'&&ATER.me&&ATER.me.owner);
function nativeP(){return['tw','kk','yt'].find(p=>ACTIVE[p]&&CHAN[p])||''}
function nativeUrl(p){return p==='tw'?'https://www.twitch.tv/popout/'+CHAN.tw+'/chat?popout=':p==='kk'?'https://kick.com/popout/'+CHAN.kk+'/chat':YTVID?'https://www.youtube.com/live_chat?is_popout=1&v='+YTVID:''}
$('#nativeBtn').onclick=()=>{const p=nativeP(),u=p&&nativeUrl(p);if(u)window.open(u,'ater-native','popup,width=420,height=720')};
const escH=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
function runCmd(raw){
  const[c0,...rest]=raw.trim().split(/\s+/),c=c0.toLowerCase(),arg=rest.join(' ');
  const say=t=>sys(t);
  switch(c){
    case'/help':case'/h':case'/commands':{const row=x=>'<code>'+x[0]+(x[1]?' '+escH(x[1]):'')+'</code> · '+x[2];const L=CMDS.filter(cmdOK);say('<b>Ater chat</b><br>'+L.filter(x=>x[3]==='a').map(row).join('<br>')+'<br><br><b>Big Screen & tools</b><br>'+L.filter(x=>!x[3]).map(row).join('<br>')+(L.some(x=>x[3]==='m')?'<br><br><b>Moderators</b><br>'+L.filter(x=>x[3]==='m'||x[3]==='o').map(row).join('<br>'):''));break}
    case'/embed':case'/e':case'/watch':{const e=parseStream(arg);if(!e){say('Try <code>/embed kick somechannel</code>, <code>/embed twitch name</code> or paste a stream link.');break}addEmbed(e,true);say('Now watching <b>'+escH(e.u)+'</b> on '+PLAT[e.p].l+'.');if(VIEW()!=='big'&&VIEW()!=='chat')go('#/bigscreen');break}
    case'/unembed':case'/remove':{const e=parseStream(arg)||curEmbed();if(!e||!removeEmbed(e))say('That stream is not on the big screen.');else say('Removed <b>'+escH(e.u)+'</b>.');break}
    case'/main':case'/mainembed':{const e=parseStream(arg);if(!e){say('Usage: <code>/main [platform] name</code>');break}addEmbed(e,true);say('<b>'+escH(e.u)+'</b> is on the main screen.');break}
    case'/embeds':say(EMB.list.length?'<b>On the big screen</b><br>'+EMB.list.map(e=>(ekey(e)===EMB.main?'★ ':'')+PLAT[e.p].l+' · '+escH(e.u)).join('<br>')+'<br><span style="color:var(--fg3)">Share this layout: '+escH(layoutUrl())+'</span>':'Nothing on the big screen yet.');break;
    case'/clearembeds':EMB.list=[];EMB.main='';saveEmb();renderStage();say('Big screen cleared.');break;
    case'/connect':{const[pw,...r]=rest;const p=platKey(pw);if(!p||!['tw','kk','yt'].includes(PK[p])){say('Usage: <code>/connect twitch|kick|youtube channel</code>');break}const q=PK[p],val=r.join(' ');if(val)FIELDS[q]=val;$('#f-'+q).value=FIELDS[q];saveFields();connect(q);say('Mixing in '+PN[q]+' chatters'+(FIELDS[q]?' from <b>'+escH(FIELDS[q])+'</b>':'')+'…');break}
    case'/disconnect':{const p=platKey(arg);const list=p?[PK[p]]:['tw','kk','yt'];list.forEach(q=>{if(ACTIVE[q])disconnect(q)});say('Stopped showing '+(p?PN[PK[p]]:'Twitch, Kick and YouTube')+' chatters.');break}
    case'/search':case'/s':openSearch(arg);break;
    case'/user':case'/u':{const n=nm(arg);const r=[...HIST].reverse().find(x=>nm(x.name)===n);if(r)userCard(r.p,r.name);else say('No messages from <b>'+escH(arg)+'</b> yet.');break}
    case'/next':openNext();break;
    case'/theater':setTheater(!document.body.classList.contains('theater'));break;
    case'/swap':swapSides();break;
    case'/size':{const n=Math.max(10,Math.min(32,parseInt(arg)||14));SET.fs=n;saveSet();say('Text size '+n+'px.');break}
    case'/cls':feed.replaceChildren();welcome();break;
    case'/popout':popout();break;
    case'/overlay':copyOverlay();break;
    case'/users':case'/who':pane('users');break;
    default:return false; /* not ours: the Ater server handles it */
  }
  return true;
}
let sending=false,lastSent='';
async function aterSend(text){
  if(aterBase()==null){sys('Ater chat needs its server. Start it with <code>node ater-server.js</code> and open <code>http://localhost:8080</code>.','sys');return false}
  if(!ATER.me){openAuth('login');return false}
  if(sending)return false;sending=true;
  const r=await aterApi('/api/send',{text,rp:REPLY&&REPLY.sid});sending=false;
  if(r.error){sys(escH(r.error),'sys');return false}
  lastSent=text;setReply(null);if(r.info)sys(escH(r.info),'sys');if(r.mine!=null&&ATER.poll){ATER.poll.mine=r.mine;renderTop()}
  return true;
}
$('#cpForm').onsubmit=async e=>{
  e.preventDefault();const v=cpIn.value.trim();if(!v)return;
  acClose();
  if(v.startsWith('/')&&runCmd(v)){cpIn.value='';return}
  cpIn.value='';
  if(!await aterSend(v)&&!cpIn.value)cpIn.value=v; /* keep what they typed if it didn't go through */
};
/* autocomplete: /commands and @names */
let acI=0,acItems=[];
function acClose(){acBox.hidden=true;acItems=[]}
function acShow(items){acItems=items;acI=0;if(!items.length)return acClose();acBox.replaceChildren(...items.map((it,i)=>{const b=h('button',i?'':'on');b.type='button';if(it.img){const im=new Image();im.src=it.img;im.alt='';im.referrerPolicy='no-referrer';b.append(im)}b.append(h('code',null,it.label),h('span',null,it.hint||''));b.onmousedown=e=>{e.preventDefault();acI=i;acPick()};return b}));acBox.hidden=false}
function acPick(){
  const it=acItems[acI];if(!it)return;
  const v=cpIn.value,pos=cpIn.selectionStart,before=v.slice(0,pos).replace(/\S*$/,'');
  cpIn.value=before+it.insert+v.slice(pos);const np=(before+it.insert).length;cpIn.setSelectionRange(np,np);acClose();cpIn.focus();
}
cpIn.addEventListener('input',()=>{
  const v=cpIn.value,pos=cpIn.selectionStart,word=(v.slice(0,pos).match(/\S*$/)||[''])[0];
  if(v.startsWith('/')&&!/\s/.test(v.slice(0,pos))){acShow(CMDS.filter(c=>cmdOK(c)&&c[0].startsWith(word.toLowerCase())).map(c=>({label:c[0]+(c[1]?' '+c[1]:''),hint:c[2],insert:c[0]+' '})));return}
  if(word.startsWith('@')&&word.length>1){const q=nm(word),seen=new Set(),out=[];const add=(n,p)=>{const k=nm(n);if(k.startsWith(q)&&!seen.has(k)&&out.length<8){seen.add(k);out.push({label:'@'+n,hint:PN[p],insert:'@'+n+' '})}};for(const u of ATER.pres.users||[])add(u.name,'at');for(let i=HIST.length-1;i>=0&&out.length<8;i--)add(HIST[i].name,HIST[i].p);acShow(out);return}
  if(/^[A-Za-z]\w+$/.test(word)&&word.length>=3&&!v.startsWith('/')){const q=word.toLowerCase(),out=knownEmotes().filter(e=>e.name.toLowerCase().startsWith(q)&&e.name!==word).slice(0,6).map(e=>({label:e.name,hint:e.sec,insert:e.name+' ',img:e.url}));acShow(out);return}
  acClose();
});
cpIn.addEventListener('keydown',e=>{
  if(e.key==='ArrowUp'&&acBox.hidden&&!cpIn.value&&lastSent){cpIn.value=lastSent;e.preventDefault();return}
  if(acBox.hidden)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();acI=(acI+(e.key==='ArrowDown'?1:-1)+acItems.length)%acItems.length;[...acBox.children].forEach((b,i)=>b.classList.toggle('on',i===acI))}
  else if(e.key==='Tab'||(e.key==='Enter'&&acItems[acI]&&cpIn.value.startsWith('/')&&!cpIn.value.trim().includes(' '))){e.preventDefault();acPick()}
  else if(e.key==='Escape'){acClose()}
});
cpIn.addEventListener('blur',()=>setTimeout(acClose,120));
/* emote picker */
const emoPick=$('#emoPick'),emoQ=$('#emoQ'),emoG=$('#emoG');
$('#emoBtn').onclick=()=>{emoPick.hidden=!emoPick.hidden;if(!emoPick.hidden){emoQ.value='';renderEmo();emoQ.focus()}};
emoQ.oninput=renderEmo;
function renderEmo(){
  const q=emoQ.value.trim().toLowerCase(),all=knownEmotes().filter(e=>!q||e.name.toLowerCase().includes(q)).slice(0,400);
  emoG.replaceChildren();let sec='';
  if(!all.length){emoG.append(h('div','h',SEV.g?'No emotes match.':'Emotes load once a chat is connected.'));return}
  for(const e of all){if(e.sec!==sec){sec=e.sec;emoG.append(h('div','h',sec))}const b=h('button');b.type='button';b.title=e.name;const i=new Image();i.src=e.url;i.alt=e.name;i.loading='lazy';i.referrerPolicy='no-referrer';b.append(i);b.onclick=()=>{const v=cpIn.value;cpIn.value=(v&&!/\s$/.test(v)?v+' ':v)+e.name+' ';cpIn.focus()};emoG.append(b)}
}
document.addEventListener('pointerdown',e=>{if(!emoPick.hidden&&!emoPick.contains(e.target)&&!e.target.closest('#emoBtn'))emoPick.hidden=true});

/* =====================================================================
   BIG SCREEN: multistream embeds (from Kestrel, now local + shareable)
   ===================================================================== */
const PLAT={
  twitch:{l:'Twitch',c:'tw',i:'i-tw',url:(u,m)=>'https://player.twitch.tv/?channel='+enc(u)+'&parent='+enc(location.hostname||'localhost')+'&autoplay=true'+(m?'&muted=true':''),page:u=>'https://www.twitch.tv/'+u},
  kick:{l:'Kick',c:'kk',i:'i-kk',url:(u,m)=>'https://player.kick.com/'+enc(u)+'?autoplay=true'+(m?'&muted=true':''),page:u=>'https://kick.com/'+u},
  youtube:{l:'YouTube',c:'yt',i:'i-yt',url:(u,m)=>(/^[\w-]{11}$/.test(u)?'https://www.youtube.com/embed/'+u+'?autoplay=1':'https://www.youtube.com/embed/live_stream?channel='+enc(u)+'&autoplay=1')+(m?'&mute=1':''),page:u=>/^[\w-]{11}$/.test(u)?'https://www.youtube.com/watch?v='+u:/^UC/.test(u)?'https://www.youtube.com/channel/'+u:'https://www.youtube.com/@'+u.replace(/^@/,'')},
  rumble:{l:'Rumble',c:'rm',i:'i-rm',url:u=>'https://rumble.com/embed/'+enc(u)+'/?autoplay=2',page:u=>'https://rumble.com/'+u},
  angelthump:{l:'AngelThump',c:'ath',i:'i-at',url:u=>'https://angelthump.com/'+enc(u)+'/embed',page:u=>'https://angelthump.com/'+u}
};
const PALIAS={tw:'twitch',twitch:'twitch',kk:'kick',kick:'kick',yt:'youtube',youtube:'youtube',rm:'rumble',rumble:'rumble',at:'angelthump',angelthump:'angelthump'};
const PK={twitch:'tw',kick:'kk',youtube:'yt'};
const platKey=w=>PALIAS[String(w||'').toLowerCase()]||'';
const ekey=e=>e.p+':'+e.u.toLowerCase();
function parseStream(s){
  s=String(s||'').trim();if(!s)return null;
  let m;
  if((m=s.match(/twitch\.tv\/([\w]+)/i)))return{p:'twitch',u:m[1].toLowerCase()};
  if((m=s.match(/kick\.com\/([\w-]+)/i)))return{p:'kick',u:m[1].toLowerCase()};
  if((m=s.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i)))return{p:'youtube',u:m[1]};
  if((m=s.match(/youtube\.com\/(?:channel\/)?(UC[\w-]{22})/i)))return{p:'youtube',u:m[1]};
  if((m=s.match(/rumble\.com\/(?:embed\/)?([\w-]+)/i)))return{p:'rumble',u:m[1]};
  const w=s.split(/\s+/);let p='twitch',u=w[0];
  if(w.length>1&&platKey(w[0])){p=platKey(w[0]);u=w[1]}
  else if(w.length===1&&w[0].includes(':')&&platKey(w[0].split(':')[0])){p=platKey(w[0].split(':')[0]);u=w[0].split(':')[1]}
  u=String(u||'').replace(/^[@#]/,'');
  if(!/^[\w\-.]{2,40}$/.test(u))return null;
  return{p,u:p==='youtube'?u:u.toLowerCase()};
}
const defEmb=()=>{const l=[];if(CONFIG.channels.twitch)l.push({p:'twitch',u:CONFIG.channels.twitch});if(CONFIG.channels.kick)l.push({p:'kick',u:CONFIG.channels.kick});if(CONFIG.channels.youtube)l.push({p:'youtube',u:CONFIG.channels.youtube});return l};
const EMB=LS.get('emb',null)||{list:defEmb(),main:''};
if(!EMB.main&&EMB.list[0])EMB.main=ekey(EMB.list[0]);
const saveEmb=()=>LS.set('emb',EMB);
const curEmbed=()=>EMB.list.find(e=>ekey(e)===EMB.main)||EMB.list[0]||null;
function addEmbed(e,main){if(!EMB.list.some(x=>ekey(x)===ekey(e)))EMB.list.push(e);if(main||!EMB.main)EMB.main=ekey(e);saveEmb();renderStage();heroSync()}
function removeEmbed(e){const k=ekey(e),n=EMB.list.length;EMB.list=EMB.list.filter(x=>ekey(x)!==k);if(EMB.main===k)EMB.main=EMB.list[0]?ekey(EMB.list[0]):'';saveEmb();renderStage();return EMB.list.length<n}
function embFromParam(s){const l=s.split(',').map(x=>parseStream(x.replace(':',' '))).filter(Boolean);if(l.length){EMB.list=l;EMB.main=ekey(l[0]);saveEmb()}}
const layoutUrl=()=>{const c=curEmbed(),l=[c,...EMB.list.filter(e=>e!==c)].filter(Boolean);return baseUrl()+'#/bigscreen?s='+l.map(e=>e.p+':'+e.u).join(',')};
function frameFor(e,muted){
  if(e.p==='twitch'&&!location.hostname){
    const d=h('div','offcard');d.innerHTML='<span class="logo"></span><h2>Twitch needs a web address</h2><p>Twitch’s player refuses to load in a page opened straight from a file. Serve this page from any host (even <code>localhost</code>) and it plays here.</p>';
    const a=h('a','btn btn-o',PLAT.twitch.l+' · '+e.u+' ↗');a.href=PLAT.twitch.page(e.u);a.target='_blank';a.rel='noopener';d.append(a);d.dataset.k=ekey(e)+(muted?':m':'');return d;
  }
  const f=document.createElement('iframe');f.src=PLAT[e.p].url(e.u,muted);f.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';f.allowFullscreen=true;f.title=PLAT[e.p].l+' · '+e.u;f.dataset.k=ekey(e)+(muted?':m':'');return f;
}
function renderStage(){
  const scrn=$('#screen'),off=$('#offcard'),cur=curEmbed();
  const old=scrn.querySelector(':scope>iframe,:scope>.offcard:not(#offcard)');
  if(VIEW()!=='big'||!cur){if(old)old.remove();off.hidden=!!cur&&VIEW()==='big'?true:false}
  else{off.hidden=true;if(!old||old.dataset.k!==ekey(cur)){if(old)old.remove();scrn.append(frameFor(cur,false))}}
  /* strip */
  const strip=$('#strip');strip.replaceChildren();
  for(const e of EMB.list){
    const c=h('span','ech'+(cur&&ekey(e)===ekey(cur)?' focus':''));const pm=h('span','pm '+PLAT[e.p].c);pm.append(icon(PLAT[e.p].i));c.append(pm);
    const b=h('button','nm-b',e.u);b.title='Put on the main screen';b.onclick=()=>{EMB.main=ekey(e);saveEmb();renderStage()};
    const x=h('button',null,'✕');x.title='Remove';x.setAttribute('aria-label','Remove '+e.u);x.onclick=()=>removeEmbed(e);
    c.append(b,x);strip.append(c);
  }
  /* now playing */
  const now=$('#now');now.replaceChildren();
  if(cur){
    const lv=liveFor(cur);if(lv&&lv.live)now.append(h('span','pill live','LIVE'));
    const pm=h('span','pm '+PLAT[cur.p].c);pm.append(icon(PLAT[cur.p].i));now.append(pm);
    const a=h('a');a.href=PLAT[cur.p].page(cur.u);a.target='_blank';a.rel='noopener';a.append(h('b',null,lv&&lv.title?lv.title:cur.u));a.title='Open on '+PLAT[cur.p].l;now.append(a);
    if(lv&&lv.live&&lv.viewers)now.append(h('span','pill mono',lv.viewers.toLocaleString()+' watching'));
    if(lv&&lv.live&&lv.since){const u=h('span','pill mono up');u.dataset.since=lv.since;u.textContent=hms((Date.now()-lv.since)/1e3);now.append(u)}
  }else now.append(h('span',null,'Big Screen'));
}
/* platform pickers */
for(const id of['#qaP','#addP'])$(id).replaceChildren(...Object.entries(PLAT).map(([k,v])=>new Option(v.l,k)));
function submitStream(p,u){const e=parseStream(u.includes(' ')||/\//.test(u)?u:p+' '+u);if(!e){toast('That doesn’t look like a channel','Use letters, numbers, - or _. Or paste the stream link.');return false}addEmbed(e,true);return true}
$('#qa').onsubmit=e=>{e.preventDefault();if(submitStream($('#qaP').value,$('#qaU').value.trim()))$('#qaU').value=''};
{
  const s=$('#sugg');for(const[k,p]of[['twitch','twitch'],['kick','kick'],['youtube','youtube']]){const u=CONFIG.channels[k];if(!u)continue;const b=h('button','btn btn-o btn-sm');const pm=h('span','pm '+PLAT[p].c);pm.append(icon(PLAT[p].i));b.append(pm,CONFIG.name+' on '+PLAT[p].l);b.onclick=()=>addEmbed({p,u},true);s.append(b)}
}
const addPop=$('#addPop'),addBtn=$('#addBtn');
function setAdd(o){addPop.hidden=!o;addBtn.setAttribute('aria-expanded',o);if(o)setTimeout(()=>$('#addU').focus(),20)}
addBtn.onclick=()=>setAdd(addPop.hidden);$('#addX').onclick=()=>setAdd(false);
$('#addForm').onsubmit=e=>{e.preventDefault();if(submitStream($('#addP').value,$('#addU').value.trim())){$('#addU').value='';setAdd(false)}};
document.addEventListener('pointerdown',e=>{if(!addPop.hidden&&!addPop.contains(e.target)&&!addBtn.contains(e.target))setAdd(false)});
/* theater / swap / hide chat / resize */
const vBig=$('#v-big');
function setTheater(o){document.body.classList.toggle('theater',o);$('#theaterBtn').classList.toggle('on',o);$('#theaterBtn').setAttribute('aria-pressed',o);if(o)toast('Theater mode','Press T or Esc to leave.')}
$('#theaterBtn').onclick=()=>setTheater(!document.body.classList.contains('theater'));
function swapSides(){vBig.dataset.swap=vBig.dataset.swap==='true'?'false':'true';LS.set('swap',vBig.dataset.swap)}
vBig.dataset.swap=LS.get('swap','false');$('#swapBtn').onclick=swapSides;
function setChat(o){vBig.dataset.chat=o?'on':'off';LS.set('chatOn',o);$('#chatToggle').classList.toggle('on',!o);syncFab();if(o&&stick)requestAnimationFrame(()=>scr.scrollTop=scr.scrollHeight)}
function syncFab(){$('#chatFab').hidden=!(VIEW()==='big'&&vBig.dataset.chat==='off')}
$('#chatToggle').onclick=()=>setChat(vBig.dataset.chat==='off');$('#cpX').onclick=()=>setChat(false);$('#chatFab').onclick=()=>setChat(true);
setChat(LS.get('chatOn',true));
{
  const rz=$('#rz'),DEF=380;let cw=LS.get('cw',DEF),drag=false;
  const setW=w=>{const max=Math.max(300,Math.min(760,vBig.clientWidth*.6));cw=Math.round(Math.max(280,Math.min(max,w)));vBig.style.setProperty('--cw',cw+'px')};
  setW(cw);
  rz.onpointerdown=e=>{drag=true;rz.setPointerCapture(e.pointerId);rz.classList.add('drag');document.body.classList.add('rzing')};
  rz.onpointermove=e=>{if(!drag)return;const r=vBig.getBoundingClientRect();setW(vBig.dataset.swap==='true'?e.clientX-r.left:r.right-e.clientX)};
  rz.onpointerup=rz.onpointercancel=()=>{if(!drag)return;drag=false;rz.classList.remove('drag');document.body.classList.remove('rzing');LS.set('cw',cw)};
  rz.ondblclick=()=>{setW(DEF);LS.set('cw',cw)};
  rz.onkeydown=e=>{const d=e.key==='ArrowLeft'?1:e.key==='ArrowRight'?-1:0;if(!d)return;e.preventDefault();setW(cw+(vBig.dataset.swap==='true'?-d:d)*24);LS.set('cw',cw)};
  addEventListener('resize',()=>setW(cw));
}

/* =====================================================================
   LIVE STATUS (best effort: Kick API, decapi.me for Twitch)
   ===================================================================== */
const LIVE={twitch:null,kick:null};
async function fetchT(url,ms=7000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw new Error(r.status);return r}finally{clearTimeout(t)}}
async function liveKick(slug){
  const j=await(await fetchT('https://kick.com/api/v2/channels/'+enc(slug))).json(),l=j&&j.livestream;
  if(!l)return{live:false};
  const at=String(l.start_time||l.created_at||'');const since=at?Date.parse(at.replace(' ','T')+(/Z|[+-]\d\d:?\d\d$/.test(at)?'':'Z')):0;
  return{live:l.is_live!==false,viewers:+l.viewer_count||0,title:l.session_title||'',since:since||0,cat:(l.categories&&l.categories[0]&&l.categories[0].name)||''};
}
async function liveTwitch(ch){
  const up=(await(await fetchT('https://decapi.me/twitch/uptime/'+enc(ch))).text()).trim();
  if(/not found|error|invalid|no user/i.test(up))return null;
  if(/offline/i.test(up))return{live:false};
  let s=0;for(const m of up.matchAll(/(\d+)\s*(day|hour|minute|second)/gi))s+=+m[1]*{day:86400,hour:3600,minute:60,second:1}[m[2].toLowerCase()];
  const[title,cat,vc]=await Promise.all(['title','game','viewercount'].map(k=>fetchT('https://decapi.me/twitch/'+k+'/'+enc(ch)).then(r=>r.text()).catch(()=>'')));
  return{live:true,since:Date.now()-s*1000,title:title.trim(),cat:cat.trim(),viewers:parseInt(vc)||0};
}
async function checkLive(){
  const c=CONFIG.channels;
  await Promise.all([
    c.kick?liveKick(c.kick).then(r=>LIVE.kick=r,()=>{}):0,
    c.twitch?liveTwitch(c.twitch).then(r=>LIVE.twitch=r,()=>{}):0
  ]);
  emit('live');
}
const liveFor=e=>e&&e.u===String(CONFIG.channels[e.p]||'').toLowerCase()?LIVE[e.p]:null;
const liveAny=()=>{for(const p of['kick','twitch'])if(LIVE[p]&&LIVE[p].live)return p;return''};
on('live',()=>{heroSync();renderStage();$('#navLive').hidden=!liveAny();document.body.classList.toggle('is-live',!!liveAny())});

/* =====================================================================
   HOME
   ===================================================================== */
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtT=d=>d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const fmtD=d=>d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
/* every scheduled slot between a and b (ms), as real Dates */
function slots(a,b){
  const out=[],d=new Date(a);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-1);
  for(;d.getTime()<b+864e5;d.setUTCDate(d.getUTCDate()+1))for(const s of CONFIG.week){if(d.getUTCDay()!==s.day)continue;const[hh,mm]=s.utc.split(':').map(Number);const st=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),hh,mm);if(st+s.hours*36e5>a&&st<b)out.push({s,start:st,end:st+s.hours*36e5})}
  return out.sort((x,y)=>x.start-y.start);
}
const nextSlot=()=>slots(Date.now(),Date.now()+14*864e5)[0]||null;
function renderWeek(){
  const w=$('#week');w.replaceChildren();
  const mon=new Date();mon.setHours(0,0,0,0);mon.setDate(mon.getDate()-((mon.getDay()+6)%7));
  const all=slots(mon.getTime(),mon.getTime()+7*864e5),today=dayKey();
  for(let i=0;i<7;i++){
    const d=new Date(mon);d.setDate(mon.getDate()+i);const k=dayKey(d.getTime());
    const mine=all.filter(x=>dayKey(x.start)===k);
    const c=h('div','day'+(mine.length?'':' off')+(k===today?' today':'')+(k<today?' past':''));
    c.append(h('span','dn',(k===today?'Today · ':'')+WD[d.getDay()]+' '+d.getDate()));
    if(!mine.length){c.append(h('span','dt','—'),h('span','dw','No stream'))}
    for(const x of mine){c.append(h('span','dt',fmtT(new Date(x.start))),h('span','dw',x.s.what+(x.s.tag?' · '+x.s.tag:'')))}
    w.append(c);
  }
}
const icsDate=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const icsEsc=s=>String(s||'').replace(/[\\;,]/g,m=>'\\'+m).replace(/\n/g,'\\n');
function ics(evts){return['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Ater Live//EN','CALSCALE:GREGORIAN',...evts.flatMap(e=>['BEGIN:VEVENT','UID:'+e.uid+'@ater.live','DTSTAMP:'+icsDate(Date.now()),'DTSTART:'+icsDate(e.start),'DTEND:'+icsDate(e.end),...(e.rrule?['RRULE:'+e.rrule]:[]),'SUMMARY:'+icsEsc(e.title),'LOCATION:'+icsEsc(e.where||''),'DESCRIPTION:'+icsEsc(e.text||''),'END:VEVENT']),'END:VCALENDAR'].join('\r\n')}
$('#icsAll').onclick=()=>{
  const seen=new Set(),ev=[];for(const x of slots(Date.now(),Date.now()+8*864e5)){const k=x.s.day+x.s.utc;if(seen.has(k))continue;seen.add(k);ev.push({uid:'week-'+k.replace(':',''),start:x.start,end:x.end,rrule:'FREQ=WEEKLY',title:CONFIG.name+' · '+x.s.what,where:CONFIG.links.twitch,text:x.s.tag})}
  dl('ater-weekly-schedule.ics',ics(ev),'text/calendar');toast('Calendar file downloaded','Open it to add the weekly streams to your calendar.');
};
function untilStr(ms){if(ms<=0)return'now';const d=ms/864e5|0,hh=ms/36e5%24|0,mm=ms/6e4%60|0;return d?d+'d '+hh+'h':hh?hh+'h '+mm+'m':mm+'m'}
function renderEvents(){
  const box=$('#events');box.replaceChildren();
  const list=CONFIG.events.map(e=>({...e,t:Date.parse(e.start)})).filter(e=>e.t+e.hours*36e5>Date.now()).sort((a,b)=>a.t-b.t);
  if(!list.length){box.append(h('div','card empty','No upcoming events. Check back soon.'));return}
  list.forEach((e,i)=>{
    const c=h('article','card ev rv'+(i===0?' next':''));
    const top=h('div','ev-top');for(const t of e.tags||[])top.append(h('span','pill',t));if(i===0)top.append(h('span','pill',' Next up'));c.append(top);
    c.append(h('h3',null,e.title));
    const w=h('div','when');w.append(icon('i-cal','i'),fmtD(new Date(e.t))+' · '+fmtT(new Date(e.t)));const b=h('b');b.dataset.until=e.t;b.textContent='in '+untilStr(e.t-Date.now());w.append(b);c.append(w);
    if(e.where)c.append(h('div','when',e.where));
    c.append(h('p',null,e.text));
    const f=h('div','ev-f');if(e.cta){const a=h('a','btn btn-p btn-sm',e.cta);a.href=e.url||'#';a.target='_blank';a.rel='noopener';f.append(a)}
    const cal=h('button','btn btn-o btn-sm');cal.append(icon('i-cal','i'),'Add to calendar');cal.onclick=()=>dl(e.title.replace(/[^\w]+/g,'-').toLowerCase()+'.ics',ics([{uid:'ev-'+e.t,start:e.t,end:e.t+e.hours*36e5,title:e.title,where:e.where,text:e.text}]),'text/calendar');f.append(cal);
    c.append(f);box.append(c);
  });
  observeReveal();
}
/* generative thumbnails */
const RB=['#6366f1','#a855f7','#ec4899','#f97316','#eab308','#22d3ee','#53fc18'];
function hashS(s){let x=2166136261;for(const c of s)x=Math.imul(x^c.charCodeAt(0),16777619);return x>>>0}
function art(title){
  const x=hashS(title),c1=RB[x%5],c2=RB[(x>>>3)%7],a=x%360,px=20+(x>>>5)%60,py=15+(x>>>9)%50,k=(x>>>13)%4;
  const pat=[`repeating-linear-gradient(${a}deg,#ffffff07 0 2px,transparent 2px 16px)`,`repeating-radial-gradient(circle at ${px}% ${py}%,#ffffff08 0 1px,transparent 1px 22px)`,`linear-gradient(#ffffff08 1px,transparent 1px) 0 0/28px 28px,linear-gradient(90deg,#ffffff08 1px,transparent 1px) 0 0/28px 28px`,`conic-gradient(from ${a}deg at ${px}% ${py}%,#ffffff0a,transparent 30%,#ffffff06 60%,transparent)`][k];
  return`${pat},radial-gradient(circle at ${px}% ${py}%,${c1}cc 0,transparent 58%),radial-gradient(circle at ${100-px}% ${100-py/2}%,${c2}99 0,transparent 55%),linear-gradient(${a}deg,#121214,#0b0b0c)`;
}
let VK='uploads';
segInit('vSeg','k','uploads',v=>{VK=v;renderVideos()});
function renderVideos(){
  const g=$('#vgrid');g.replaceChildren();const list=CONFIG.videos[VK]||[];
  const pf=VK==='clips'?'tw':'yt',url=VK==='clips'?CONFIG.links.twitch:CONFIG.links.youtube;
  for(const[t,d,du]of list){
    const a=h('a','vc');a.href=url||'#';a.target='_blank';a.rel='noopener';
    const th=h('div','th'),ar=h('div','art');ar.style.background=art(t);th.append(ar);
    const lg=h('span','logo');lg.style.cssText='position:absolute;right:12px;top:12px;height:18px;opacity:.5';th.append(lg);
    th.append(h('span','tt',t),h('span','du',du));
    const pl=h('div','pl'),ps=h('span');ps.append(icon('i-play','i'));pl.append(ps);th.append(pl);
    const meta=h('div','meta');meta.style.display='flex';meta.style.gap='6px';meta.style.alignItems='center';meta.append(pmark(pf),new Date(d+'T12:00:00').toLocaleDateString([],{month:'long',day:'numeric',year:'numeric'}));
    a.append(th,h('h3',null,t),meta);g.append(a);
  }
  $('#vMore').hidden=list.length<=8;$('#vMore').textContent=g.classList.contains('collapsed')?'Show more':'Show less';
}
$('#vMore').onclick=()=>{$('#vgrid').classList.toggle('collapsed');renderVideos()};
/* community */
let CR='day';segInit('cSeg','r','day',v=>{CR=v;renderCommunity()});
function renderCommunity(){boardList($('#podium'),lbCalc(CR,'chat',8),8)}
function renderPulse(){
  const p=pulse();
  $('#pmMin').textContent=p.min;$('#pmUsers').textContent=p.users;
  const sp=$('#spark'),max=Math.max(1,...p.bars);if(sp.children.length!==30)sp.replaceChildren(...p.bars.map(()=>h('i')));
  [...sp.children].forEach((b,i)=>{b.style.height=Math.max(2,p.bars[i]/max*28)+'px';b.classList.toggle('hot',i>=27)});
  $('#sMsgs').textContent=TODAY.msgs.toLocaleString();$('#sUsers').textContent=todayUsers.size.toLocaleString();$('#sLinks').textContent=TODAY.links.toLocaleString();$('#sPeak').textContent=TODAY.peak.toLocaleString();
  const te=$('#topEmotes'),top=topEmotes(6);
  if(!top.length){if(!te.dataset.e){te.replaceChildren(h('span',null,'Top emotes of the last hour show up here'));te.dataset.e=1}}
  else{te.dataset.e='';te.replaceChildren(...top.map(([n,v])=>{const s=h('span');s.title=n;const i=new Image();i.src=v.url;i.alt=n;i.referrerPolicy='no-referrer';s.append(i,'×'+v.n);return s}))}
}
/* merch art */
const MERCH={
  tee:'<svg viewBox="0 0 100 100"><path d="M34 16 22 21 10 35l11 9 6-5v45h46V39l6 5 11-9-12-14-12-5c-2 5-8 8-16 8s-14-3-16-8z" fill="#1d1d20" stroke="#ffffff1f"/><path d="M34 16c2 5 8 8 16 8s14-3 16-8" fill="none" stroke="#ffffff2a"/></svg>',
  hoodie:'<svg viewBox="0 0 100 100"><path d="M36 14c3-5 25-5 28 0l14 7 12 16-10 8-6-5v47H26V40l-6 5-10-8 12-16z" fill="#161618" stroke="#ffffff1f"/><path d="M36 14c0 10 6 16 14 16s14-6 14-16" fill="#0f0f10" stroke="#ffffff22"/><path d="M36 68h28v12H36z" fill="none" stroke="#ffffff1c"/><path d="M45 30v12M55 30v12" stroke="#ffffff30"/><rect x="26" y="86" width="48" height="3" fill="url(#rbm)"/><defs><linearGradient id="rbm"><stop offset="0" stop-color="#6366f1"/><stop offset=".3" stop-color="#a855f7"/><stop offset=".55" stop-color="#ec4899"/><stop offset=".8" stop-color="#f97316"/><stop offset="1" stop-color="#eab308"/></linearGradient></defs></svg>',
  pins:'<svg viewBox="0 0 100 100"><defs><linearGradient id="rbp" x1="0" x2="1"><stop offset="0" stop-color="#6366f1"/><stop offset=".33" stop-color="#ec4899"/><stop offset=".66" stop-color="#f97316"/><stop offset="1" stop-color="#eab308"/></linearGradient></defs><circle cx="32" cy="38" r="17" fill="#0e0e10" stroke="url(#rbp)" stroke-width="4"/><circle cx="68" cy="36" r="14" fill="#a970ff"/><path d="M62 30h3v12h-3zm6 0h3v12h-3z" fill="#fff"/><circle cx="50" cy="70" r="15" fill="#53fc18"/><path d="M44 62h5v5h3v-5h5v6h-3v4h3v6h-5v-5h-3v5h-5z" fill="#0a0a0b"/></svg>',
  sticker:'<svg viewBox="0 0 100 100"><defs><linearGradient id="rbs" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset=".3" stop-color="#a855f7"/><stop offset=".55" stop-color="#ec4899"/><stop offset=".8" stop-color="#f97316"/><stop offset="1" stop-color="#eab308"/></linearGradient></defs><g transform="rotate(-8 50 50)"><rect x="18" y="26" width="64" height="44" rx="12" fill="url(#rbs)"/><rect x="21" y="29" width="58" height="38" rx="9" fill="#0b0b0c"/><text x="50" y="54" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="15" fill="#f4f4f5" letter-spacing="-.5">ATER</text></g><g transform="rotate(10 70 76)"><rect x="56" y="64" width="30" height="22" rx="6" fill="#f4f4f5"/><text x="71" y="79" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="9" fill="#0a0a0b">W</text></g></svg>'
};
function renderMerch(){
  const g=$('#merchGrid');g.replaceChildren();$('#storeBtn').href=CONFIG.links.store||'#';
  for(const m of CONFIG.merch){
    const c=h('a','card mc rv');c.href=CONFIG.links.store||'#';c.target='_blank';c.rel='noopener';
    const mi=h('div','mi');mi.innerHTML=MERCH[m.kind]||MERCH.tee;
    if(m.kind==='tee'||m.kind==='hoodie'){const l=h('span','logo');l.style.cssText='position:absolute;left:50%;top:'+(m.kind==='tee'?'44%':'49%')+';height:12%;transform:translate(-50%,-50%)';mi.append(l)}
    const pr=h('div','pr');pr.append(h('span',null,m.price),h('span','btn btn-o btn-sm','View'));
    c.append(mi,h('h3',null,m.name),pr);g.append(c);
  }
}
function renderAbout(){
  $('#aboutH').textContent='About '+CONFIG.name;
  $('#aboutBody').replaceChildren(...CONFIG.about.map(t=>h('p',null,t)));
  const a=$('#aboutLinks');a.replaceChildren();
  for(const[k,ic,t]of[['twitch','i-tw','Twitch'],['kick','i-kk','Kick'],['youtube','i-yt','YouTube'],['x','i-xs','X']]){const u=CONFIG.links[k];if(!u||u==='#')continue;const b=h('a','btn btn-o btn-sm');b.href=u;b.target='_blank';b.rel='noopener';const s=icon(ic,'i');if(PK[k])s.classList.add(PK[k]+'-c');b.append(s,t);a.append(b)}
}
/* hero */
let heroK='';
function heroSync(){
  const lp=liveAny(),L=lp?LIVE[lp]:null,media=$('#heroMedia'),card=$('#heroCard');
  card.classList.toggle('live',!!lp);
  /* preview iframe only while home is visible */
  const want=VIEW()==='home'&&lp&&!(lp==='twitch'&&!location.hostname)?lp+':'+CONFIG.channels[lp]:'';
  if(want!==heroK){heroK=want;const old=media.querySelector('iframe,.unmute');media.querySelectorAll('iframe,.unmute').forEach(e=>e.remove());
    if(want){media.append(frameFor({p:lp,u:CONFIG.channels[lp]},true));const b=h('a','btn btn-p btn-sm unmute');b.href='#/bigscreen';b.append(icon('i-tv','i'),'Watch with sound');b.onclick=()=>addEmbed({p:lp,u:CONFIG.channels[lp]},true);media.append(b)}}
  $('#poster').hidden=!!want;
  const badge=$('#heroBadge');badge.replaceChildren();
  const chips=$('#heroChips');chips.replaceChildren();
  const ns=nextSlot(),now=Date.now();
  if(lp){
    badge.append(h('span','pill live','LIVE'));
    chips.append(h('span','pill live','Live'));
    const tot=['kick','twitch'].reduce((a,p)=>a+(LIVE[p]&&LIVE[p].live?LIVE[p].viewers||0:0),0);
    if(tot)chips.append(h('span','pill mono',tot.toLocaleString()+' viewers'));
    if(L.since){const u=h('span','pill mono up');u.dataset.since=L.since;u.textContent=hms((now-L.since)/1e3);chips.append(u)}
    for(const p of['kick','twitch'])if(LIVE[p]&&LIVE[p].live){const c=h('span','pill');c.append(pmark(PK[p]),PLAT[p].l);chips.append(c)}
    if(L.cat)chips.append(h('span','pill',L.cat));
    $('#heroTitle').textContent=L.title||CONFIG.name+' is live';
    $('#heroSub').textContent='Live now. Open the Big Screen to watch with every chat at once.';
  }else{
    const known=['kick','twitch'].some(p=>LIVE[p]&&LIVE[p].live===false);
    if(known)chips.append(h('span','pill off','Offline'));
    if(ns){const c=h('span','pill');c.append(icon('i-cal','i'),fmtD(new Date(ns.start))+' · '+fmtT(new Date(ns.start)));chips.append(c);if(ns.s.tag)chips.append(h('span','pill',ns.s.tag))}
    const inSlot=ns&&ns.start<=now;
    $('#heroTitle').textContent=inSlot?CONFIG.name+' should be live right now':ns?'Next up: '+ns.s.what+', '+WD[new Date(ns.start).getDay()]+' at '+fmtT(new Date(ns.start)):CONFIG.name;
    $('#heroSub').textContent=inSlot?'Open the Big Screen to catch it with every chat at once.':'Catch up on the latest videos below, or open the Big Screen and watch someone else with Ater Chat.';
    $('#posterT').innerHTML=inSlot?'<b>Starting any minute</b>':ns?'Next stream <b>'+fmtD(new Date(ns.start))+'</b> at <b>'+fmtT(new Date(ns.start))+'</b>':'<b>'+CONFIG.name+'</b>';
    $('#cd').hidden=!ns||inSlot;
  }
}
function tick(){
  const now=Date.now();
  $$('.up[data-since]').forEach(e=>e.textContent=hms((now-+e.dataset.since)/1e3));
  $$('[data-until]').forEach(e=>e.textContent='in '+untilStr(+e.dataset.until-now));
  const cd=$('#cd');if(!cd.hidden){const ns=nextSlot();if(ns){let s=Math.max(0,(ns.start-now)/1e3|0);const parts=[[s/86400|0,'days'],[s/3600%24|0,'hours'],[s/60%60|0,'min'],[s%60,'sec']];if(cd.children.length!==4)cd.replaceChildren(...parts.map(()=>{const sp=h('span');sp.append(h('b'),h('small'));return sp}));parts.forEach(([v,l],i)=>{cd.children[i].firstChild.textContent=pad(v);cd.children[i].lastChild.textContent=l});if(s===0)heroSync()}}
  $$('.tm[data-ends]').forEach(e=>{const s=Math.max(0,Math.ceil((+e.dataset.ends-now)/1e3));e.textContent=s?Math.floor(s/60)+':'+pad(s%60):'Ending…'});
}

/* =====================================================================
   ATER CHAT UI: account, pins, polls, people, replies, platform mix
   ===================================================================== */
/* ---- sign in / create account ---- */
const authM=$('#authM');let authMode='login';
function openAuth(m){
  if(aterBase()==null){toast('Ater chat is offline','Start it with node ater-server.js and open http://localhost:8080.',5000);return}
  setAuthMode(m||'login');$('#authE').textContent='';authM.hidden=false;setTimeout(()=>$('#authN').focus(),30);
}
function setAuthMode(m){authMode=m;$$('#authSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));$('#authB').textContent=m==='login'?'Sign in':'Create account';$('#authT').textContent=m==='login'?'Sign in to Ater chat':'Join Ater chat';$('#authP').autocomplete=m==='login'?'current-password':'new-password';$('#authH').textContent=m==='login'?'Ater accounts live on this site only. They’re separate from Twitch, Kick and YouTube.':'Pick a name (3–20 letters, numbers or _) and a password of 8+ characters. Your chats get the Ater badge.'}
$$('#authSeg button').forEach(b=>b.onclick=()=>setAuthMode(b.dataset.m));
$('#authX').onclick=()=>authM.hidden=true;authM.onclick=e=>{if(e.target===authM)authM.hidden=true};
$('#authF').onsubmit=async e=>{
  e.preventDefault();const b=$('#authB');b.disabled=true;$('#authE').textContent='';
  const r=await aterApi(authMode==='login'?'/api/auth/login':'/api/auth/register',{name:$('#authN').value.trim(),password:$('#authP').value});
  b.disabled=false;
  if(r.error){$('#authE').textContent=r.error;return}
  $('#authP').value='';authM.hidden=true;
  ATER.me=r.me;ME=r.me.name;mkAR();syncAuth();aterStart();
  toast(authMode==='login'?'Welcome back, '+ME:'Welcome to Ater, '+ME,r.me.owner?'You’re the broadcaster here.':'Say hi in chat.');
  if(VIEW()==='home')go('#/bigscreen');setTimeout(()=>cpIn.focus(),80);
};
async function signOut(){await aterApi('/api/auth/logout',{});ATER.me=null;ME=null;mkAR();$('#meMenu').hidden=true;syncAuth();aterStart();toast('Signed out','')}
$('#signBtn').onclick=()=>openAuth('login');

/* ---- account chip + menu ---- */
const meMenu=$('#meMenu'),meChip=$('#meChip');
function swatches(){
  const w=h('div','sw8'),cur=(ATER.me&&ATER.me.color)||'';
  const mk=(c,t)=>{const b=h('button',c===cur?'on':'');b.type='button';b.title=t||c;if(c)b.style.background=c;else b.classList.add('rs');b.onclick=async()=>{const r=await aterApi('/api/send',{text:'/color '+(c||'reset')});if(r.error)return toast('Couldn’t change colour',r.error);ATER.me.color=c;syncAuth();if(PANE==='set')renderSet();if(!meMenu.hidden)fillMeMenu()};w.append(b)};
  mk('','Default (picked from your name)');for(const c of NAMECOL.concat(['#ffffff','#53fc18']))mk(c);return w;
}
function fillMeMenu(){const u=ATER.me;if(!u)return;const av=$('#mmAv');av.textContent=u.name[0];av.style.background=u.color||colorFor(u.name);$('#mmName').textContent=u.name;$('#mmName').style.color=u.color||colorFor(u.name);$('#mmRole').textContent=u.owner?'Broadcaster':u.mod?'Moderator':'Ater chatter';$('#mmSw').replaceWith(Object.assign(swatches(),{id:'mmSw'}))}
meChip.onclick=e=>{e.stopPropagation();const o=meMenu.hidden;meMenu.hidden=!o;meChip.setAttribute('aria-expanded',o);if(o)fillMeMenu()};
document.addEventListener('pointerdown',e=>{if(!meMenu.hidden&&!meMenu.contains(e.target)&&!meChip.contains(e.target)){meMenu.hidden=true;meChip.setAttribute('aria-expanded',false)}});
$('#mmOut').onclick=signOut;$('#mmSet').onclick=()=>{meMenu.hidden=true;go('#/bigscreen');setTimeout(()=>pane('set'),60)};
function syncAuth(){
  const srv=aterBase()!=null,u=ATER.me;
  $('#signBtn').hidden=!srv||!!u;meChip.hidden=!u;
  if(u){const av=$('#meAv');av.textContent=u.name[0];av.style.background=u.color||colorFor(u.name);$('#meName').textContent=u.name}
  cpIn.placeholder=u?'Chat as '+u.name+'…':srv?'Sign in to chat, or type / for commands':'Type / for commands';
}

/* ---- replies ---- */
let REPLY=null;
function setReply(r){REPLY=r;$('#rply').hidden=!r;if(r){const t=$('#rplyT');t.replaceChildren('Replying to ',h('b',null,r.name),' · '+r.text);pane('chat');cpIn.focus()}}
$('#rplyX').onclick=()=>setReply(null);

/* ---- pins + polls above chat ---- */
function renderTop(){
  const t=$('#atTop');t.replaceChildren();const mod=ATER.me&&ATER.me.mod,hid=LS.get('pinx',[]);
  for(const p of ATER.pins||[]){
    if(hid.includes(p.id))continue;
    const c=h('div','pin');c.append(icon('i-pin','i'));
    const b=h('div','pb'),hd=h('div','ph');const n=h('b',null,p.name);n.style.color=p.color||colorFor(p.name);hd.append('Pinned · ',n);if(p.by&&p.by!==p.name)hd.append(' · by '+p.by);b.append(hd);
    const tx=h('div','px');for(const k of aterTokens(p.text)){if(typeof k==='string')linkify(tx,k);else tx.append(emoteEl(k))}b.append(tx);c.append(b);
    const x=h('button','ic');x.title=mod?'Unpin for everyone':'Hide this pin';x.append(icon('i-x'));
    x.onclick=async()=>{if(mod){const r=await aterApi('/api/unpin',{id:p.id});if(r.error)toast('Couldn’t unpin',r.error)}else{LS.set('pinx',[...hid,p.id].slice(-50));renderTop()}};
    c.append(x);t.append(c);
  }
  const P=ATER.poll;
  if(P){
    const c=h('div','poll'),q=h('div','pq');q.append(icon('i-poll','i'),h('span',null,P.q));
    const tm=h('span','tm');if(P.done)tm.textContent='Final';else{tm.dataset.ends=P.ends;tm.textContent='…'}q.append(tm);c.append(q);
    const show=P.done||P.mine!=null,max=Math.max(...P.opts.map(o=>o.n));
    P.opts.forEach((o,i)=>{
      const pct=P.total?Math.round(o.n/P.total*100):0;
      const b=h('button','po'+(P.mine===i?' mine':'')+(P.done&&o.n===max&&max>0?' win':''));b.type='button';
      const bar=h('i');bar.style.width=show?pct+'%':'0';b.append(bar,h('span',null,(i+1)+'. '+o.t));if(show)b.append(h('b',null,o.n+' · '+pct+'%'));
      b.disabled=P.done||P.mine!=null;b.style.opacity=1;
      b.onclick=async()=>{if(!ATER.me)return openAuth('login');const r=await aterApi('/api/vote',{i});if(r.error)return toast('Vote didn’t count',r.error);P.mine=r.mine;renderTop()};
      c.append(b);
    });
    const f=h('div','pf2');f.append(P.total+' vote'+(P.total===1?'':'s')+' · by '+P.by);if(!show&&!P.done)f.append(' · results show after you vote');f.append(h('span','sp'));
    if(mod&&!P.done){const e2=h('button','btn btn-o btn-sm','End poll');e2.onclick=()=>aterApi('/api/send',{text:'/endpoll'});f.append(e2)}
    c.append(f);t.append(c);
  }
}
const pollM=$('#pollM');
function pollOpt(v){const d=h('div'),i=h('input');i.placeholder='Option';i.maxLength=80;i.value=v||'';const x=h('button','ic');x.type='button';x.append(icon('i-x'));x.onclick=()=>{if($('#pollOpts').children.length>2)d.remove()};d.append(i,x);$('#pollOpts').append(d)}
function openPoll(){if(!(ATER.me&&ATER.me.mod))return;$('#pollOpts').replaceChildren();pollOpt();pollOpt();$('#pollQ').value='';$('#pollE').textContent='';pollM.hidden=false;setTimeout(()=>$('#pollQ').focus(),30)}
$('#pollAdd').onclick=()=>{if($('#pollOpts').children.length<8)pollOpt()};
$('#pollX').onclick=()=>pollM.hidden=true;pollM.onclick=e=>{if(e.target===pollM)pollM.hidden=true};
$('#pollF').onsubmit=async e=>{e.preventDefault();const opts=$$('#pollOpts input').map(i=>i.value.trim()).filter(Boolean);const r=await aterApi('/api/poll',{q:$('#pollQ').value.trim(),opts,secs:+$('#pollS').value});if(r.error){$('#pollE').textContent=r.error;return}pollM.hidden=true;pane('chat')};

/* ---- who's here ---- */
function renderUsers(){
  $('#usersN').textContent=ATER.pres.n||0;
  if(PANE!=='users')return;
  const L=$('#ulist');L.replaceChildren();
  if(!ATER.up){L.append(h('div','empty',aterBase()==null?'Ater chat needs its server running to see who’s here.':'Connecting…'));return}
  const us=ATER.pres.users||[],grp=[['Broadcaster',us.filter(u=>u.owner)],['Moderators',us.filter(u=>u.mod&&!u.owner)],['Chatters',us.filter(u=>!u.mod)]];
  for(const[t,l]of grp){
    if(!l.length)continue;L.append(h('h5',null,t+' · '+l.length));
    for(const u of l){const r=h('div','ur');r.append(aterBadgeEl());for(const b of aterBadges(u.b))r.append(badgeEl(b));const n=h('span',null,u.name);n.style.color=u.color||colorFor(u.name);r.append(n);r.onclick=()=>userCard('at',u.name);L.append(r)}
  }
  const anon=Math.max(0,(ATER.pres.n||0)-us.length);
  L.append(h('p','hint',(us.length?'':'No one signed in yet. ')+(anon?anon+' more watching without an account.':'')));
}
$('#usersBtn').onclick=()=>pane(PANE==='users'?'chat':'users');

/* ---- platform chatters on/off ---- */
async function setPlatform(p,v){
  if(v){
    if(p==='tw'&&!FIELDS.tw||p==='kk'&&!FIELDS.kk||p==='yt'&&!(FIELDS.yt&&FIELDS.ytk)){setSheet(true,p);toast('Pick a '+PN[p]+' channel first','Then switch it on.');if(PANE==='set')renderSet();return}
    const ok=await connect(p);if(ok)toast('Showing '+PN[p]+' chatters','Marked with the '+PN[p]+' logo. Switch them off in chat settings.');
    else if(p==='kk'&&!relayBase(FIELDS.kkrl))setSheet(true,'kk');
  }else disconnect(p);
  if(PANE==='set')renderSet();
}

on('ater',k=>{
  syncAuth();syncStatus();renderUsers();
  if(k==='hello'||k==='pins'||k==='poll')renderTop();
  if(k==='emotes'&&!emoPick.hidden)renderEmo();
  if(k==='hello'||k==='settings'||k==='emotes'){if(PANE==='set')renderSet()}
});
/* reveal */
const io='IntersectionObserver'in window?new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');e.target.querySelectorAll('.rb.wait').forEach(r=>{r.classList.remove('wait');r.classList.add('go')});io.unobserve(e.target)}}),{rootMargin:'0px 0px -8% 0px'}):null;
function observeReveal(){$$('.rv:not(.in)').forEach(el=>io?io.observe(el):el.classList.add('in'))}

/* =====================================================================
   COMMAND PALETTE
   ===================================================================== */
const pal=$('#pal'),palQ=$('#palQ'),palL=$('#palL');let palI=0,palA=[];
function palActions(q){
  const A=[
    {g:'Go',t:'Home',i:'i-home',run:()=>go('#/')},{g:'Go',t:'Big Screen',i:'i-tv',run:()=>go('#/bigscreen')},
    {g:'Go',t:'Schedule',i:'i-cal',run:()=>scrollToSec('schedule')},{g:'Go',t:'Videos',i:'i-play',run:()=>scrollToSec('videos')},{g:'Go',t:'Merch',i:'i-heart',run:()=>scrollToSec('merch')},
    ...(aterBase()!=null&&!ATER.me?[{g:'Ater chat',t:'Sign in',i:'i-chat',run:()=>openAuth('login')},{g:'Ater chat',t:'Create an account',i:'i-chat',run:()=>openAuth('register')}]:[]),
    ...(ATER.me?[{g:'Ater chat',t:'Sign out',i:'i-out',run:signOut}]:[]),
    ...(ATER.me&&ATER.me.mod?[{g:'Ater chat',t:'Start a poll',i:'i-poll',run:()=>{go('#/bigscreen');setTimeout(openPoll,60)}}]:[]),
    {g:'Ater chat',t:'Who’s here',i:'i-users',run:()=>{go('#/bigscreen');setTimeout(()=>pane('users'),60)}},
    ...['tw','kk','yt'].map(p=>({g:'Ater chat',t:(ACTIVE[p]?'Hide ':'Show ')+PN[p]+' chatters',i:PI[p],run:()=>setPlatform(p,!ACTIVE[p])})),
    {g:'Chat',t:'Change platform channels',i:'i-layers',run:()=>setSheet(true)},
    {g:'Chat',t:'Open next link',i:'i-link',k:'N',run:openNext},
    {g:'Chat',t:'Search chat',i:'i-search',run:()=>{go('#/bigscreen');setTimeout(()=>openSearch(),60)}},
    {g:'Chat',t:'Mentions',i:'i-bell',run:()=>{go('#/bigscreen');setTimeout(()=>pane('inbox'),60)}},
    {g:'Chat',t:'Leaderboard',i:'i-trophy',run:()=>{go('#/bigscreen');setTimeout(()=>pane('board'),60)}},
    {g:'Chat',t:'Links queue',i:'i-link',run:()=>{go('#/bigscreen');setTimeout(()=>pane('links'),60)}},
    {g:'Chat',t:'Chat settings',i:'i-gear',run:()=>{go('#/bigscreen');setTimeout(()=>pane('set'),60)}},
    {g:'Chat',t:'Pop out chat',i:'i-pop',run:popout},
    {g:'Chat',t:'Copy OBS overlay link',i:'i-copy',run:copyOverlay},
    {g:'Big Screen',t:'Theater mode',i:'i-theater',k:'T',run:()=>{go('#/bigscreen');setTheater(!document.body.classList.contains('theater'))}},
    {g:'Big Screen',t:'Swap chat side',i:'i-swap',run:()=>{go('#/bigscreen');swapSides()}},
    {g:'Big Screen',t:'Copy link to this layout',i:'i-copy',run:()=>copy(layoutUrl()).then(ok=>toast(ok?'Layout link copied':'Layout link',ok?'Anyone who opens it gets the same streams.':layoutUrl(),5000))},
    ...EMB.list.map(e=>({g:'On the big screen',t:'Watch '+e.u+' on '+PLAT[e.p].l,i:PLAT[e.p].i,run:()=>{EMB.main=ekey(e);saveEmb();go('#/bigscreen');renderStage()}}))
  ];
  q=q.trim();const out=[];
  if(q.startsWith('/'))out.push({g:'Run',t:'Run '+q,i:'i-chat',run:()=>{go('#/bigscreen');setTimeout(()=>runCmd(q),60)}});
  else if(q){
    const s=parseStream(q.replace(/^(embed|watch)\s+/i,''));
    if(s&&(/\s|\//.test(q)||platKey(q.split(/\s/)[0])))out.push({g:'Watch',t:'Watch '+s.u+' on '+PLAT[s.p].l,i:PLAT[s.p].i,run:()=>{addEmbed(s,true);go('#/bigscreen')}});
    const m=q.match(/^(?:connect\s+)?(twitch|kick|youtube)\s+chat\s+(\S+)/i)||q.match(/^connect\s+(twitch|kick|youtube)\s+(\S+)/i);
    if(m){const p=PK[platKey(m[1])];out.push({g:'Chat',t:'Read '+m[2]+'’s '+PN[p]+' chat',i:PI[p],run:()=>{FIELDS[p]=m[2];$('#f-'+p).value=m[2];saveFields();connect(p)}})}
  }
  const words=q.toLowerCase().split(/\s+/).filter(Boolean);
  return out.concat(q.startsWith('/')?[]:A.filter(a=>words.every(w=>(a.g+' '+a.t).toLowerCase().includes(w))));
}
function renderPal(){
  palA=palActions(palQ.value);palI=Math.min(palI,Math.max(0,palA.length-1));palL.replaceChildren();let g='';
  if(!palA.length)palL.append(h('div','empty','Nothing matches. Try “kick somechannel” or a /command.'));
  palA.forEach((a,i)=>{if(a.g!==g){g=a.g;palL.append(h('div','gh',g))}const b=h('button',i===palI?'on':'');b.setAttribute('role','option');b.append(icon(a.i),h('span',null,a.t));if(a.k){const k=h('span','k');k.append(h('kbd',null,a.k));b.append(k)}b.onmouseenter=()=>{palI=i;[...palL.querySelectorAll('button')].forEach((x,j)=>x.classList.toggle('on',j===i))};b.onclick=()=>palRun(i);palL.append(b)});
}
function palRun(i){const a=palA[i];setPal(false);if(a)a.run()}
function setPal(o){pal.hidden=!o;if(o){palQ.value='';palI=0;renderPal();setTimeout(()=>palQ.focus(),10)}}
palQ.oninput=()=>{palI=0;renderPal()};
palQ.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();palI=(palI+(e.key==='ArrowDown'?1:-1)+palA.length)%Math.max(1,palA.length);renderPal();const on_=palL.querySelector('button.on');if(on_)on_.scrollIntoView({block:'nearest'})}else if(e.key==='Enter'){e.preventDefault();palRun(palI)}};
pal.onclick=e=>{if(e.target===pal)setPal(false)};
$('#palBtn').onclick=()=>setPal(true);

/* =====================================================================
   KEYBOARD
   ===================================================================== */
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPal(pal.hidden);return}
  if(e.key==='Escape'){if(!pal.hidden)return setPal(false);if(!authM.hidden)return authM.hidden=true;if(!pollM.hidden)return pollM.hidden=true;if(!meMenu.hidden)return meMenu.hidden=true;if(REPLY)return setReply(null);if(!sheet.hidden)return setSheet(false);if(!addPop.hidden)return setAdd(false);if(!emoPick.hidden)return emoPick.hidden=true;if(!$('#ucard').hidden)return $('#ucard').hidden=true;if(document.body.classList.contains('theater'))return setTheater(false);if(PANE!=='chat'&&VIEW()!=='home')return pane('chat')}
  if(isTyping(e)||e.ctrlKey||e.metaKey||e.altKey)return;
  const k=e.key.toLowerCase();
  if(k==='n'){e.preventDefault();openNext()}
  else if(k==='t'&&VIEW()==='big'){e.preventDefault();setTheater(!document.body.classList.contains('theater'))}
  else if(k==='/'&&VIEW()!=='home'){e.preventDefault();pane('chat');cpIn.focus();cpIn.value='/';cpIn.dispatchEvent(new Event('input'))}
});

/* =====================================================================
   BOOT
   ===================================================================== */
$('#yr').textContent=new Date().getFullYear();
$('#subBtn').href=CONFIG.links.subscribe||'#';$('#donBtn').href=CONFIG.links.donate||'#';
applySet();renderWeek();renderEvents();renderVideos();renderMerch();renderAbout();renderCommunity();renderLinks();renderInbox();
kickHint();syncStatus();route();heroSync();renderPulse();observeReveal();
setInterval(tick,1000);tick();
setInterval(()=>{renderPulse();if(VIEW()==='home'&&CR==='day')renderCommunity()},2000);
on('emotesets',()=>{if(!emoPick.hidden)renderEmo()});
on('set',()=>{if(PANE==='inbox')renderInbox()});
if(CONFIG.liveStatus&&!OV){checkLive();setInterval(checkLive,90000)}
/* Ater chat is always on; platform chatters come back only if you switched them on last time */
syncAuth();aterStart();
{const onL=LS.get('on',{});for(const p of['tw','kk','yt'])if(onL[p])connect(p)}
