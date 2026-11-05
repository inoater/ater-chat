/* =====================================================================
   ATER LIVE: social
   Role looks on names, image fitting, profile cards, the profile editor,
   chat rooms and direct messages. Loaded after app.js and uses its helpers.
   ===================================================================== */

/* ---------- role looks ---------- */
const LOOK_KINDS=[['none','Plain'],['solid','Solid'],['gradient','Gradient'],['glow','Glow'],['shimmer','Shimmer'],['outline','Outline'],['glass','Glass']];
function clearLook(el){el.classList.remove(...LOOK_KINDS.map(([k])=>'lk-'+k));for(const p of['background-image','text-shadow','--c1','--c2','--glow','-webkit-text-stroke'])el.style.removeProperty(p)}
/** Paint a name with a role's look. `base` is the colour to fall back to. */
function applyLook(el,l,base){
  clearLook(el);if(!l||l.kind==='none'){el.style.color=base||'';return}
  const c1=l.c1||base,c2=l.c2||c1,c3=l.c3,g=l.glow||c1;
  el.classList.add('lk-'+l.kind);el.style.setProperty('--c1',c1);el.style.setProperty('--c2',c2);el.style.setProperty('--glow',g);
  if(l.kind==='solid')el.style.color=c1;
  else if(l.kind==='gradient'||l.kind==='shimmer')el.style.backgroundImage='linear-gradient(90deg,'+[c1,c2,c3,l.kind==='shimmer'?c1:''].filter(Boolean).join(',')+')';
  else if(l.kind==='glow'){el.style.color=c1;el.style.textShadow='0 0 6px '+g+',0 0 14px '+g+'99'}
  else if(l.kind==='outline'||l.kind==='glass')el.style.color='';
}
function styleName(el,roleId,base){
  el.dataset.r=roleId;el.dataset.base=base||'';
  const r=ATER.roles.get(roleId);if(r&&r.look&&r.look.kind!=='none')applyLook(el,r.look,base);
}
/* a role's look changed: restyle names already on screen */
function restyleAll(){for(const el of $$('.nm[data-r]')){const r=ATER.roles.get(el.dataset.r);applyLook(el,r&&r.look,el.dataset.base)}}

/* ---------- images: resize and compress in the browser before upload ---------- */
const FIT={avatar:{w:128,h:128,mode:'cover',max:256,bytes:250e3},badge:{w:72,h:72,mode:'contain',max:128,bytes:120e3},emote:{h:112,maxW:448,mode:'height',maxH:128,maxWW:512,bytes:300e3}};
const asDataUrl=file=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file)});
/**
 * Fit an image to what it's for: profile pictures are cropped square (128 px),
 * role badges fit inside 72 px, emotes are 112 px tall. Small animated GIFs are
 * kept as they are, since a canvas would freeze them; bigger ones become a still.
 * Returns { data, still } where still means a GIF lost its animation.
 */
async function fitImage(file,kind){
  const k=FIT[kind];
  if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type))throw new Error('Use a PNG, JPEG, GIF or WebP image.');
  if(file.size>10e6)throw new Error('That file is over 10 MB.');
  const url=URL.createObjectURL(file),img=new Image();img.src=url;
  try{await img.decode()}catch{URL.revokeObjectURL(url);throw new Error('That image couldn’t be opened.')}
  const iw=img.naturalWidth,ih=img.naturalHeight;
  if(file.type==='image/gif'){
    const fits=kind==='emote'?ih<=k.maxH&&iw<=k.maxWW:iw<=k.max&&ih<=k.max;
    if(fits&&file.size<=k.bytes){URL.revokeObjectURL(url);return{data:await asDataUrl(file),still:false}}
  }
  let cw,ch,dx=0,dy=0,dw,dh;
  if(k.mode==='cover'){cw=k.w;ch=k.h;const sc=Math.max(cw/iw,ch/ih);dw=iw*sc;dh=ih*sc;dx=(cw-dw)/2;dy=(ch-dh)/2}
  else if(k.mode==='contain'){cw=k.w;ch=k.h;const sc=Math.min(cw/iw,ch/ih,4);dw=iw*sc;dh=ih*sc;dx=(cw-dw)/2;dy=(ch-dh)/2}
  else{let sc=Math.min(1,k.h/ih);if(iw*sc>k.maxW)sc=k.maxW/iw;cw=Math.max(1,Math.round(iw*sc));ch=Math.max(1,Math.round(ih*sc));dw=cw;dh=ch}
  const c=document.createElement('canvas');c.width=cw;c.height=ch;const x=c.getContext('2d');x.imageSmoothingQuality='high';
  x.drawImage(img,dx,dy,dw,dh);URL.revokeObjectURL(url);
  let data='';for(const q of[.92,.85,.75,.6]){data=c.toDataURL('image/webp',q);if(!data.startsWith('data:image/webp'))data=c.toDataURL('image/png');if(data.length*.75<=k.bytes)break}
  if(data.length*.75>k.bytes)throw new Error('That image is still too big after resizing. Try a simpler one.');
  return{data,still:file.type==='image/gif'};
}
/** Ask for a file, fit it, hand back the data URL (or null if cancelled). */
function pickImage(kind){
  return new Promise(ok=>{const i=document.createElement('input');i.type='file';i.accept='image/png,image/jpeg,image/gif,image/webp';
    i.onchange=async()=>{const f=i.files[0];if(!f)return ok(null);try{const r=await fitImage(f,kind);if(r.still)toast('Saved as a still image','Animated GIFs need to be small already to stay animated.');ok(r.data)}catch(e){toast('Couldn’t use that image',e.message);ok(null)}};i.click()});
}

/* ---------- avatars ---------- */
function avatarEl(u,size){
  const a=h('span','uav');a.style.width=a.style.height=size+'px';a.style.fontSize=Math.round(size*.42)+'px';
  const base=aterBase()||'';
  if(u&&u.av){const i=new Image();i.alt='';i.src=base+u.av;i.onerror=()=>{i.remove();a.textContent=(u.name||'?')[0]};a.append(i)}
  else{a.textContent=((u&&u.name)||'?')[0];a.style.background=(u&&(u.acc||u.color))||colorFor((u&&u.name)||'?')}
  return a;
}

/* ---------- profile cards ---------- */
const pcard=$('#pcard'),PCACHE=new Map();
async function profileOf(name,fresh){
  const k=nm(name),hit=PCACHE.get(k);if(hit&&!fresh&&Date.now()-hit.t<30e3)return hit.p;
  const p=await aterApi('/api/user/'+enc(name));if(!p.error)PCACHE.set(k,{p,t:Date.now()});return p;
}
const roleList=()=>[...ATER.roles.values()];
/** Timeout lengths I may give, in minutes. */
function myTimeouts(){
  const me=ATER.me;if(!me)return[];
  if(me.mod)return[1,10,60,1440,10080];
  let max=0;for(const id of me.roles||[]){const r=ATER.roles.get(id);if(r&&r.perms&&r.perms.includes('timeout'))max=Math.max(max,r.timeoutMin||0)}
  return[1,5,10,30,60].filter(m=>m<=max);
}
const durTxt=m=>m>=1440?(m/1440)+(m===1440?' day':' days'):m>=60?(m/60)+(m===60?' hour':' hours'):m+' min';
/**
 * Open someone's profile card next to whatever was clicked. The card has a
 * data-theme for card looks (gradient, metallic…) to come later.
 */
async function openCard(name,anchor){
  const p=await profileOf(name,true);
  if(p.error){toast('No Ater account',name+' hasn’t signed up here.');return}
  pcard.replaceChildren();pcard.dataset.theme=p.cardTheme||'default';
  const acc=p.acc||p.color||colorFor(p.name);
  const ban=h('div','pc-ban');ban.style.background='radial-gradient(120% 140% at 0% 0%,'+acc+'cc,transparent 60%),linear-gradient(135deg,'+acc+'66,#0a0a0b 80%)';
  const x=h('button','ic pc-x');x.title='Close';x.append(icon('i-x'));x.onclick=closeCard;ban.append(x);
  const av=avatarEl(p,76);av.classList.add('pc-av');
  const body=h('div','pc-b');
  const nmEl=h('b','nm pc-nm',p.name);nmEl.style.color=p.color||colorFor(p.name);if(p.r)styleName(nmEl,p.r,p.color||colorFor(p.name));
  const top=h('div','pc-n');top.append(nmEl);
  for(const b of aterBadges(p.b))top.append(badgeEl(b));
  body.append(top);
  if(p.pronouns)body.append(h('div','pc-pr',p.pronouns));
  const chips=h('div','pc-roles');
  for(const id of p.roles||[]){const r=ATER.roles.get(id);if(!r)continue;const c=h('span','pc-role');const dot=h('i');dot.style.background=(r.look&&r.look.kind!=='none'&&r.look.c1)||'var(--fg3)';c.append(dot);if(r.badge){const im=new Image();im.src=r.badge;im.alt='';c.append(im)}c.append(r.name);chips.append(c)}
  if(chips.children.length)body.append(chips);
  if(p.bio){const bio=h('p','pc-bio');for(const t of aterTokens(p.bio)){if(typeof t==='string')linkify(bio,t);else bio.append(emoteEl(t))}body.append(bio)}
  const st=h('div','pc-st');
  st.append(h('span',null,'Joined '+new Date(p.created).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})),h('span',null,(p.msgs||0).toLocaleString()+(p.msgs===1?' message':' messages')));
  if(p.streak>1)st.append(h('span',null,p.streak+'-day streak'));
  for(const[pl,n]of Object.entries(p.verified||{})){const v=h('a','ver');v.href=pl==='twitch'?'https://www.twitch.tv/'+n:'https://kick.com/'+n;v.target='_blank';v.rel='noopener';v.title='Linked and verified';v.append(icon(pl==='twitch'?'i-tw':'i-kk','i'),n,' ✓');st.append(v)}
  body.append(st);
  const me=ATER.me,self=me&&nm(me.name)===nm(p.name),a=h('div','pc-a');
  const btn=(t,ic,f,cls)=>{const b=h('button','btn btn-sm '+(cls||'btn-o'));if(ic)b.append(icon(ic,'i'));b.append(t);b.onclick=f;a.append(b);return b};
  if(me&&!self){btn('Message','i-mail',()=>{closeCard();openDM(p.name)},'btn-p');btn('Mention','i-chat',()=>{closeCard();pane('chat');cpIn.value=(cpIn.value?cpIn.value.replace(/\s*$/,' '):'')+'@'+p.name+' ';cpIn.focus()})}
  if(self)btn('Edit profile','i-gear',()=>{closeCard();openAccount()},'btn-p');
  btn('Their messages','i-search',()=>{closeCard();userCard.list=true;userCard('at',p.name)});
  body.append(a);
  /* the mod team */
  if(me&&!self&&me.staff)body.append(cardMod(p));
  pcard.append(ban,av,body);
  pcard.hidden=false;placeCard(anchor);
}
function cardMod(p){
  const me=ATER.me,box=h('div','pc-mod');box.append(h('h5',null,'Moderate'));
  const roles=roleList().filter(r=>r.id!=='owner'&&(r.id==='mod'?me.owner:me.mod&&(!p.mod||me.owner)));
  if(roles.length){
    const rw=h('div','pc-rs');
    for(const r of roles){const on=(p.roles||[]).includes(r.id),b=h('button','pc-rt'+(on?' on':''));b.type='button';b.append(r.badge?Object.assign(new Image(),{src:r.badge,alt:''}):h('i'),r.name);b.title=(on?'Take ':'Give ')+r.name;
      b.onclick=async()=>{const q=await aterApi('/api/mod/role',{name:p.name,role:r.id,on:!on});if(q.error)return toast('Didn’t work',q.error);toast(on?'Role taken':'Role given',r.name+(on?' from ':' to ')+p.name);openCard(p.name,lastAnchor)};rw.append(b)}
    box.append(rw);
  }
  const t=myTimeouts(),row=h('div','row2');
  if(t.length){const sel=h('select');t.forEach(m=>sel.append(new Option('Time out '+durTxt(m),m)));const go=h('button','btn btn-o btn-sm','Apply');go.onclick=async()=>{const q=await aterApi('/api/mod/timeout',{name:p.name,minutes:+sel.value});toast(q.error?'Didn’t work':'Timed out',q.error||p.name+' for '+durTxt(+sel.value))};row.append(sel,go)}
  if(me.mod){const b=h('button','btn btn-o btn-sm danger','Ban…');b.onclick=async()=>{const why=prompt('Ban '+p.name+' from Ater chat? Reason (optional):','');if(why===null)return;const q=await aterApi('/api/mod/ban',{name:p.name,why});toast(q.error?'Didn’t work':'Banned',q.error||p.name)};row.append(b)}
  if(row.children.length)box.append(row);
  return box;
}
let lastAnchor=null;
function placeCard(anchor){
  lastAnchor=anchor||lastAnchor;const r=pcard.getBoundingClientRect(),W=innerWidth,H=innerHeight;
  let a=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null;
  if(W<640||!a){pcard.style.left=Math.max(8,(W-r.width)/2)+'px';pcard.style.top=Math.max(8,(H-r.height)/2)+'px';return}
  let x=a.left-r.width-12;if(x<8)x=Math.min(W-r.width-8,a.right+12);
  let y=Math.min(Math.max(8,a.top-40),H-r.height-8);
  pcard.style.left=x+'px';pcard.style.top=y+'px';
}
function closeCard(){pcard.hidden=true}
document.addEventListener('pointerdown',e=>{if(!pcard.hidden&&!pcard.contains(e.target)&&!e.target.closest('.nm,.ur,.ctxm'))closeCard()},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pcard.hidden){closeCard();e.stopPropagation()}},true);
/* clicks on names open the card next to them */
document.addEventListener('click',e=>{const n=e.target.closest('.nm[data-n]');if(n&&n.dataset.p==='at'&&VIEW()!=='home'){e.stopImmediatePropagation();openCard(n.dataset.n,n)}},true);

/* ---------- profile editor (Account & security) ---------- */
let PROF=null;
async function fillProfile(){
  const a=await aterApi('/api/account');if(a.error)return;PROF=a;
  const box=$('#peAvIn');box.replaceChildren(avatarEl(a,64));
  $('#peColor').value=a.color||colorFor(a.name);$('#peAccent').value=a.accent||a.color||colorFor(a.name);
  $('#pePron').value=a.pronouns||'';$('#peBio').value=a.bio||'';$('#peDm').value=a.dmFrom||'everyone';
  $('#peColor').dataset.touched=a.color?'1':'';$('#peAccent').dataset.touched=a.accent?'1':'';
}
$('#peColor').oninput=()=>$('#peColor').dataset.touched='1';$('#peAccent').oninput=()=>$('#peAccent').dataset.touched='1';
$('#peReset').onclick=()=>{$('#peColor').dataset.touched='';$('#peAccent').dataset.touched='';$('#peColor').value=colorFor(ME||'x');$('#peAccent').value=colorFor(ME||'x');toast('Colours reset','Save to keep it.')};
$('#peSave').onclick=async()=>{
  const r=await aterApi('/api/account/profile',{color:$('#peColor').dataset.touched?$('#peColor').value:'',accent:$('#peAccent').dataset.touched?$('#peAccent').value:'',pronouns:$('#pePron').value,bio:$('#peBio').value,dmFrom:$('#peDm').value});
  if(r.error)return acErr(r.error);toast('Profile saved','');PCACHE.delete(nm(ME||''));fillProfile();
};
$('#peView').onclick=()=>openCard(ME,$('#peView'));
$('#peAv').onclick=e=>{
  const items=[{label:'Upload a picture',icon:'i-img',run:async()=>{const d=await pickImage('avatar');if(!d)return;const r=await aterApi('/api/account/avatar',{data:d});if(r.error)return toast('Couldn’t save it',r.error);toast('Picture updated','');PCACHE.delete(nm(ME));fillProfile()}}];
  if(PROF&&PROF.av)items.push({label:'Remove picture',icon:'i-x',danger:1,run:async()=>{await aterApi('/api/account/avatar',{clear:true});PCACHE.delete(nm(ME));fillProfile()}});
  const r=e.currentTarget.getBoundingClientRect();ctxMenu(items,r.left,r.bottom+4);
};
/* openAccount (app.js) also fills the profile now */
{const base=openAccount;openAccount=async function(){await base();fillProfile()};$('#mmAcct').onclick=()=>openAccount()}

/* ---------- rooms ---------- */
let CUR_ROOM=LS.get('room','live');const FEEDS=new Map([['live',LIVE_FEED]]),ROOM_UNREAD={};
const roomRO=window.ResizeObserver?new ResizeObserver(()=>{if(stick)scr.scrollTop=scr.scrollHeight}):null;
function feedOf(id){
  let f=FEEDS.get(id);
  if(!f){f=h('div','feed');f.dataset.roomf=id;f.hidden=id!==CUR_ROOM;scr.append(f);FEEDS.set(id,f);applySet();if(roomRO)roomRO.observe(f)}
  return f;
}
const knownRoom=id=>ATER.rooms.some(r=>r.id===id);
function roomFeed(m){
  const id=m.p==='at'?(m.room||'live'):'live',r=knownRoom(id)?id:'live';
  if(r!==CUR_ROOM&&!m.hist&&m.p==='at'){ROOM_UNREAD[r]=(ROOM_UNREAD[r]||0)+1;renderRoomBar()}
  return feedOf(r);
}
function setRoom(id){
  if(!knownRoom(id))id='live';CUR_ROOM=id;LS.set('room',id);
  feedOf(id);for(const[k,f]of FEEDS)f.hidden=k!==id;feed=FEEDS.get(id);ROOM_UNREAD[id]=0;
  const r=ATER.rooms.find(x=>x.id===id)||{name:'Live chat'};
  $('#gBar').hidden=id!=='live'||!GUEST.p;$('#gAsk').hidden=id!=='live'||$('#gAsk').hidden;
  if(ATER.me)cpIn.placeholder=id==='live'?'Chat as '+ATER.me.name+'…':'Message #'+r.name+'…';
  if(id!=='live'&&!feed.querySelector('.msg')){const w=h('div','welcome');w.innerHTML='<span class="logo" aria-hidden="true"></span>';w.append(h('h3',null,'#'+r.name),h('p',null,r.topic||'Nothing here yet. Say hi.'));feed.append(w)}
  renderRoomBar();stick=true;unread=0;syncJump();requestAnimationFrame(()=>scr.scrollTop=scr.scrollHeight);
}
function roomBtn(r,cur,unreadN,onClick){
  const b=h('button',r.id===cur?'on':'');b.type='button';b.title=r.topic||r.name;
  b.append(icon('i-hash','i'),r.name);if(r.view==='signedin')b.classList.add('priv');
  if(unreadN&&r.id!==cur)b.append(h('span','cnt',unreadN>99?'99+':String(unreadN)));
  b.onclick=onClick;return b;
}
function renderRoomBar(){
  const bar=$('#roomBar');bar.hidden=ATER.rooms.length<2;if(bar.hidden)return;
  bar.replaceChildren(...ATER.rooms.map(r=>roomBtn(r,CUR_ROOM,ROOM_UNREAD[r.id],()=>setRoom(r.id))));
}
/* the home page chat panel: room tabs and a send box */
function renderMiniRooms(){
  const bar=$('#miniRooms');bar.hidden=ATER.rooms.length<2;
  if(!bar.hidden)bar.replaceChildren(...ATER.rooms.map(r=>roomBtn(r,MINI_ROOM,0,()=>setMiniRoom(r.id))));
  $('#miniForm').hidden=!ATER.me;
  $('#miniIn').placeholder=MINI_ROOM==='live'?'Say something…':'Message #'+((ATER.rooms.find(r=>r.id===MINI_ROOM)||{}).name||'')+'…';
}
function setMiniRoom(id){
  MINI_ROOM=knownRoom(id)?id:'live';
  const mini=$('#miniFeed');[...mini.querySelectorAll('.msg')].forEach(e=>e.remove());
  const list=BUF.filter(m=>!m.bot&&!m.guest&&(m.p==='at'?(m.room||'live'):'live')===MINI_ROOM).slice(-18);
  $('#miniEmpty').hidden=!!list.length;for(const m of list)mini.append(renderMsg(m,{ts:false}));
  renderMiniRooms();
}
$('#miniForm').onsubmit=async e=>{e.preventDefault();const v=$('#miniIn').value.trim();if(!v)return;$('#miniIn').value='';const r=await aterApi('/api/send',{text:v,room:MINI_ROOM});if(r.error){toast('Didn’t send',r.error);$('#miniIn').value=v}};
on('ater',k=>{
  if(k==='hello'||k==='rooms'){if(!knownRoom(CUR_ROOM))CUR_ROOM='live';setRoom(CUR_ROOM);setMiniRoom(MINI_ROOM)}
  if(k==='roles'){restyleAll();PCACHE.clear()}
  if(k==='hello'||k==='me'||k==='rooms')renderMiniRooms();
  syncSocial();
});

/* ---------- direct messages ---------- */
const DM={view:'list',with:null,convs:[],msgs:[]};
function syncSocial(){
  const me=ATER.me;
  $('#navMod').hidden=!(me&&me.staff);$('#dmBtn').hidden=!me;$('#dmTab').hidden=!me;
  const n=ATER.dmUnread||0;for(const id of['#dmN','#dmTop']){const c=$(id);c.hidden=!n;c.textContent=n>99?'99+':n}
}
async function loadConvs(){if(!ATER.me)return;const r=await aterApi('/api/dm/list');if(r.error)return;DM.convs=r.convs;ATER.dmUnread=r.convs.reduce((a,c)=>a+c.unread,0);syncSocial()}
function renderDMs(){
  const L=$('#dmsL');L.replaceChildren();
  if(!ATER.me){const w=h('div','empty','Sign in to send and get messages.');const b=h('button','btn btn-p btn-sm','Sign in');b.onclick=()=>openAuth('login');L.append(w,b);return}
  if(DM.view==='thread'&&DM.with)return renderThread();
  const top=h('form','dm-new');const i=h('input');i.placeholder='Message someone: type a name';i.setAttribute('list','dmPeople');
  const dl=h('datalist');dl.id='dmPeople';for(const u of ATER.pres.users||[])if(nm(u.name)!==nm(ME))dl.append(new Option(u.name));
  const go=h('button','btn btn-p btn-sm','Open');top.append(i,dl,go);top.onsubmit=e=>{e.preventDefault();if(i.value.trim())openDM(i.value.trim())};L.append(top);
  const list=h('div','dm-list');
  if(!DM.convs.length)list.append(h('div','empty','No messages yet. Messages here are saved, so people get them even when they’re offline.'));
  for(const c of DM.convs){
    const row=h('button','dm-row'+(c.unread?' un':''));row.type='button';
    const av=avatarEl(c.with,36);if(c.online)av.classList.add('on');
    const t=h('div','dm-t'),n=h('b','nm',c.with.name);n.style.color=c.with.color||colorFor(c.with.name);if(c.with.r)styleName(n,c.with.r,c.with.color||colorFor(c.with.name));
    const top2=h('div');top2.append(n,h('span','dm-ts',ago(c.last.ts)));
    t.append(top2,h('span','dm-last',(nm(c.last.from)===nm(ME)?'You: ':'')+c.last.text));
    row.append(av,t);if(c.unread)row.append(h('span','cnt',String(c.unread)));
    row.onclick=()=>openDM(c.with.name);list.append(row);
  }
  L.append(list);
}
async function openDM(name,text){
  if(!ATER.me)return openAuth('login');
  if(VIEW()==='home')go('#/bigscreen');
  DM.view='thread';DM.with=name;pane('dms');
  const r=await aterApi('/api/dm/thread?with='+enc(name));
  if(r.error){toast('Can’t open that',r.error);DM.view='list';return renderDMs()}
  DM.with=r.with.name;DM.who=r.with;DM.msgs=r.messages;DM.blocked=r.blocked;
  renderThread();aterApi('/api/dm/read',{with:DM.with}).then(loadConvs);
  if(text)sendDM(text);
}
function renderThread(){
  const L=$('#dmsL');L.replaceChildren();const w=DM.who||{name:DM.with};
  const hd=h('div','dm-h');const back=h('button','ic');back.title='All messages';back.append(icon('i-back'));back.onclick=()=>{DM.view='list';DM.with=null;loadConvs().then(renderDMs)};
  const who=h('button','dm-who');who.type='button';who.append(avatarEl(w,28));const n=h('b','nm',w.name);n.style.color=w.color||colorFor(w.name);if(w.r)styleName(n,w.r,w.color||colorFor(w.name));who.append(n);who.onclick=()=>openCard(w.name,who);
  const more=h('button','ic');more.title='More';more.append(icon('i-gear'));
  more.onclick=e=>{const r=e.currentTarget.getBoundingClientRect();ctxMenu([
    {label:'View profile',icon:'i-users',run:()=>openCard(w.name,who)},
    {label:DM.blocked?'Unblock '+w.name:'Block '+w.name,icon:'i-shield',danger:!DM.blocked,run:async()=>{const q=await aterApi('/api/account/block',{name:w.name,on:!DM.blocked});if(q.error)return toast('Didn’t work',q.error);DM.blocked=!DM.blocked;toast(DM.blocked?'Blocked':'Unblocked',DM.blocked?w.name+' can’t message you now.':'')}},
    {label:'Clear this conversation for me',icon:'i-trash',run:async()=>{await aterApi('/api/dm/hide',{with:w.name});DM.view='list';DM.with=null;loadConvs().then(renderDMs)}}],r.left-150,r.bottom+4)};
  hd.append(back,who,h('span','sp'),more);L.append(hd);
  const box=h('div','dm-msgs');box.id='dmMsgs';
  if(!DM.msgs.length)box.append(h('div','empty','Say hi to '+w.name+'. They’ll see it next time they’re on.'));
  let lastDay='';for(const m of DM.msgs){const d=dayKey(m.ts);if(d!==lastDay){lastDay=d;box.append(h('div','dm-day',new Date(m.ts).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})))}box.append(bubble(m))}
  L.append(box);
  const f=h('form','dm-in');const i=h('input');i.placeholder='Message '+w.name+'…';i.maxLength=1000;const s=h('button','ic');s.type='submit';s.title='Send';s.append(icon('i-send'));
  f.append(i,s);f.onsubmit=e=>{e.preventDefault();const v=i.value.trim();if(!v)return;i.value='';sendDM(v).then(ok=>{if(!ok)i.value=v})};L.append(f);
  requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;i.focus()});
}
function bubble(m){
  const mine=nm(m.from)===nm(ME),b=h('div','dm-b'+(mine?' me':''));
  const t=h('div','dm-tx');for(const x of aterTokens(m.text)){if(typeof x==='string')linkify(t,x);else t.append(emoteEl(x))}
  b.append(t,h('span','dm-ts',clock(m.ts)));return b;
}
async function sendDM(text){
  const r=await aterApi('/api/dm/send',{to:DM.with,text});
  if(r.error){toast('Not sent',r.error);return false}
  return true;
}
on('dm',m=>{
  const other=nm(m.from)===nm(ME)?m.to:m.from;
  const open=PANE==='dms'&&DM.view==='thread'&&nm(DM.with||'')===nm(other)&&VIEW()!=='home';
  if(open){const box=$('#dmMsgs');if(box){const em=box.querySelector('.empty');if(em)em.remove();box.append(bubble(m));box.scrollTop=box.scrollHeight}if(nm(m.from)!==nm(ME))aterApi('/api/dm/read',{with:other})}
  else if(nm(m.from)!==nm(ME)){ATER.dmUnread=(ATER.dmUnread||0)+1;syncSocial();toast('Message from '+m.from,m.text);ping();if(PANE==='dms')loadConvs().then(renderDMs)}
});
on('ater',k=>{if(k==='hello'&&ATER.me)loadConvs()});
$('#dmBtn').onclick=()=>{DM.view='list';go('#/bigscreen');setTimeout(()=>pane('dms'),60)};
syncSocial();
