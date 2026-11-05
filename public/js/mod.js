/* =====================================================================
   ATER LIVE: mod dashboard (#/mod)
   Overview, reports, people, roles, emotes, bans and timeouts, polls,
   rooms, the mod log and chat settings. Each section shows only for
   people whose role can use it; the server checks every action again.
   ===================================================================== */
const PERM_TXT={
  reports:['Handle reports','See the report queue and act on it'],
  delete:['Delete messages','Remove messages from people ranked below them'],
  timeout:['Time people out','Up to the limit below (an hour at most)'],
  pin:['Pin messages','Pin notes and messages above chat'],
  polls:['Run polls','Start and end polls'],
  emotes:['Emotes','Add and remove emotes'],
  links:['Post links right away','Skips the wait for new accounts'],
  slow:['Skip slow mode','Chat at normal speed when slow mode is on'],
  feature:['Set the Ater pick','Choose the Big Screen stream when the broadcaster is offline'],
  words:['Blocked words','Add and remove blocked words'],
};
const DSECT=[
  ['overview','Overview','i-home',()=>true],
  ['reports','Reports','i-flag',()=>dHas('reports')],
  ['people','People','i-users',()=>true],
  ['roles','Roles','i-shield',()=>dMod()],
  ['emotes','Emotes','i-smile',()=>dHas('emotes')],
  ['bans','Bans & timeouts','i-mute',()=>dMod()||dHas('timeout')],
  ['polls','Polls','i-poll',()=>dHas('polls')],
  ['rooms','Rooms','i-hash',()=>dMod()],
  ['log','Mod log','i-layers',()=>dMod()],
  ['settings','Chat settings','i-gear',()=>dMod()||dHas('words')||dHas('feature')],
];
const dMod=()=>!!(ATER.me&&ATER.me.mod),dOwner=()=>!!(ATER.me&&ATER.me.owner),dHas=p=>!!(ATER.me&&(ATER.me.mod||(ATER.me.perms||[]).includes(p)));
let DSEC=LS.get('dsec','overview');
const dCard=(title,...kids)=>{const c=h('section','dcard');if(title)c.append(h('h3',null,title));c.append(...kids.filter(Boolean));return c};
const dErr=r=>{if(r&&r.error){toast('Didn’t work',r.error);return true}return false};
const dBtn=(t,cls,f)=>{const b=h('button','btn btn-sm '+(cls||'btn-o'),t);b.type='button';b.onclick=f;return b};
const nameLine=u=>{const n=h('b','nm',u.name);n.dataset.p='at';n.dataset.n=u.name;n.style.color=u.color||colorFor(u.name);if(u.r)styleName(n,u.r,u.color||colorFor(u.name));return n};

function renderDash(){
  const nav=$('#dnav'),main=$('#dmain');nav.replaceChildren();main.replaceChildren();
  if(!ATER.me){main.append(dCard('Mod dashboard',h('p','hint','Sign in with a mod-team account to use the dashboard.'),dBtn('Sign in','btn-p',()=>openAuth('login'))));return}
  if(!ATER.me.staff){main.append(dCard('Mod dashboard',h('p','hint','This is for the mod team. Moderators can give roles with powers from here.')));return}
  const allowed=DSECT.filter(s=>s[3]());if(!allowed.some(s=>s[0]===DSEC))DSEC='overview';
  const hd=h('div','dn-h');hd.append(avatarEl(ATER.me,34));const t=h('div');t.append(h('b',null,ATER.me.name),h('small',null,ATER.me.owner?'Admin':ATER.me.mod?'Moderator':'Mod team'));hd.append(t);nav.append(hd);
  for(const[id,label,ic]of allowed){const b=h('button',id===DSEC?'on':'');b.type='button';b.append(icon(ic,'i'),label);if(id==='reports'&&ATER.reports)b.append(h('span','cnt',String(ATER.reports)));b.onclick=()=>{DSEC=id;LS.set('dsec',id);renderDash()};nav.append(b)}
  const back=h('a','dn-back');back.href='#/bigscreen';back.append(icon('i-back','i'),'Back to the Big Screen');nav.append(back);
  ({overview:dOverview,reports:dReports,people:dPeople,roles:dRoles,emotes:dEmotes,bans:dBans,polls:dPolls,rooms:dRooms,log:dLog,settings:dSettings}[DSEC])(main);
}
/* live changes redraw the dashboard, except report counts while you're busy in another section */
on('ater',k=>{if(VIEW()==='mod'&&['hello','me','roles','rooms','modqueue','emotes','settings','featured'].includes(k)){if(k==='modqueue'&&DSEC!=='overview'&&DSEC!=='reports')return;renderDash()}});

/* ---- overview ---- */
async function dOverview(main){
  const o=await aterApi('/api/mod/overview');if(dErr(o))return;
  main.append(h('h2','dh','Overview'));
  const g=h('div','dstats');
  for(const[n,l]of[[o.online,'watching now'],[o.signedIn,'signed in'],[o.accounts,'accounts'],[o.today,'messages today'],[o.openReports,'open reports'],[o.timeouts,'timed out'],[o.bans,'banned'],[o.emotes,'custom emotes']]){const c=h('div','dstat');c.append(h('b',null,(n||0).toLocaleString()),h('small',null,l));g.append(c)}
  main.append(g);
  if(o.poll&&!o.poll.done){const p=o.poll;main.append(dCard('Poll running',h('p',null,p.q+' · '+p.total+' votes'),dHas('polls')?dBtn('End it now','btn-o',async()=>{dErr(await aterApi('/api/poll/end',{}));renderDash()}):null))}
  if(dHas('reports')){const box=h('div','dlist');if(!o.reports.length)box.append(h('div','empty','No open reports.'));for(const r of o.reports)box.append(reportRow(r));main.append(dCard('Newest reports',box))}
  if(dMod()&&o.log.length){const box=h('div','dlist');for(const e of o.log)box.append(logRow(e));main.append(dCard('Latest mod actions',box,dBtn('Full mod log','',()=>{DSEC='log';renderDash()})))}
  if(!dMod())main.append(dCard('Your powers',h('p','hint',(ATER.me.perms||[]).map(p=>(PERM_TXT[p]||[p])[0]).join(' · ')||'None yet.')));
}

/* ---- reports ---- */
function reportRow(x){
  const c=h('div','rep'),hd=h('div','h');hd.append(nameLine({name:x.msg.name}),'· reported by '+x.by+' · '+ago(x.ts)+(x.msg.room&&x.msg.room!=='live'?' · #'+x.msg.room:''));c.append(hd);
  const q=h('div','q');for(const t of aterTokens(x.msg.text)){if(typeof t==='string')linkify(q,t);else q.append(emoteEl(t))}c.append(q);
  if(x.reason)c.append(h('div','hint','“'+x.reason+'”'));
  const a=h('div','a');
  for(const[act,label,cls,need]of[['delete','Delete message','btn-o','delete'],['mute','Time out 10m','btn-o','timeout'],['ban','Ban','btn-o danger','ban'],['dismiss','Dismiss','','reports']]){
    if(need==='ban'?!dMod():!dHas(need))continue;
    a.append(dBtn(label,cls,async()=>{if(act==='ban'&&!confirm('Ban '+x.msg.name+'?'))return;if(!dErr(await aterApi('/api/mod/reports/resolve',{id:x.id,action:act})))renderDash()}));
  }
  c.append(a);return c;
}
async function dReports(main){
  main.append(h('h2','dh','Reports'));
  const r=await aterApi('/api/mod/reports');if(dErr(r))return;
  const box=h('div','dlist');if(!r.reports.length)box.append(h('div','empty','No open reports. Anyone can report a message by hovering it or right-clicking it.'));
  for(const x of r.reports)box.append(reportRow(x));main.append(box);
}

/* ---- people ---- */
let PQ='',PF='';
async function dPeople(main){
  main.append(h('h2','dh','People'));
  const tools=h('div','dtools');const q=h('input');q.placeholder='Search accounts';q.value=PQ;
  const seg=h('div','seg');for(const[v,l]of[['','Everyone'],['staff','Mod team'],['timedout','Timed out'],['banned','Banned']]){const b=h('button',PF===v?'on':'',l);b.onclick=()=>{PF=v;renderDash()};seg.append(b)}
  tools.append(q,seg);main.append(tools);
  const list=h('div','dtable');main.append(list);
  let t=0;q.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{PQ=q.value;load()},250)};
  async function load(){
    const r=await aterApi('/api/mod/users?q='+enc(PQ)+'&filter='+PF);if(dErr(r))return;list.replaceChildren();
    if(!r.users.length)list.append(h('div','empty','Nobody matches.'));
    for(const u of r.users){
      const row=h('div','drow');const who=h('div','dwho');who.append(avatarEl(u,30));const nmw=h('div');nmw.append(nameLine(u));
      const chips=h('div','dchips');for(const id of u.roles||[]){const rr=ATER.roles.get(id);if(rr)chips.append(h('span','pill',rr.name))}nmw.append(chips);who.append(nmw);
      const st=h('div','dst');st.append((u.msgs||0).toLocaleString()+(u.msgs===1?' message':' messages')+' · joined '+ago(u.created));
      if(u.banned)st.append(h('span','pill bad','Banned'));if(u.mutedUntil)st.append(h('span','pill warn','Timed out · '+untilStr(u.mutedUntil-Date.now())));
      const more=h('button','ic');more.title='Actions';more.append(icon('i-gear'));more.onclick=e=>{const b=e.currentTarget.getBoundingClientRect();ctxMenu(personMenu(u,load),b.left-180,b.bottom+4)};
      row.append(who,st,more);row.oncontextmenu=e=>{e.preventDefault();ctxMenu(personMenu(u,load),e.clientX,e.clientY)};list.append(row);
    }
    if(r.total>r.users.length)list.append(h('p','hint','Showing '+r.users.length+' of '+r.total+'. Search to narrow it down.'));
  }
  load();
}
function personMenu(u,reload){
  const me=ATER.me,out=[{head:u.name},{label:'Profile card',icon:'i-users',run:()=>openCard(u.name)}];
  if(nm(u.name)===nm(me.name))return out;
  const give=[...ATER.roles.values()].filter(r=>r.id!=='owner'&&(r.id==='mod'?me.owner:me.mod&&(!u.mod||me.owner)));
  if(give.length)out.push({label:'Roles',icon:'i-shield',sub:give.map(r=>{const on=(u.roles||[]).includes(r.id);return{label:(on?'✓ ':'')+r.name,run:async()=>{if(!dErr(await aterApi('/api/mod/role',{name:u.name,role:r.id,on:!on})))reload()}}})});
  const t=myTimeouts();
  if(t.length)out.push({label:'Time out',icon:'i-mute',sub:t.map(m=>({label:durTxt(m),run:async()=>{if(!dErr(await aterApi('/api/mod/timeout',{name:u.name,minutes:m})))reload()}})).concat(u.mutedUntil?[{sep:1},{label:'Lift timeout',run:async()=>{if(!dErr(await aterApi('/api/mod/unmute',{name:u.name})))reload()}}]:[])});
  if(me.mod)out.push(u.banned?{label:'Unban',icon:'i-shield',run:async()=>{if(!dErr(await aterApi('/api/mod/unban',{name:u.name})))reload()}}:{label:'Ban…',icon:'i-shield',danger:1,run:async()=>{const why=prompt('Ban '+u.name+'? Reason (optional):','');if(why===null)return;if(!dErr(await aterApi('/api/mod/ban',{name:u.name,why})))reload()}});
  return out;
}

/* ---- roles ---- */
let RSEL=null;
function dRoles(main){
  main.append(h('h2','dh','Roles'),h('p','hint','Roles sit in order: anyone can only act on people below them. The top role a person has decides how their name looks; up to three role badges show beside it.'+(dOwner()?'':' Only the admin can change the Admin and Moderator roles or make moderators.')));
  const wrap=h('div','droles');const list=h('div','drl'),ed=h('div','dre');wrap.append(list,ed);main.append(wrap);
  const roles=[...ATER.roles.values()];
  if(RSEL!=='new'&&(!RSEL||!ATER.roles.has(RSEL)))RSEL=roles[0]&&roles[0].id;
  for(const[i,r]of roles.entries()){
    const row=h('button','drr'+(r.id===RSEL?' on':''));row.type='button';
    const n=h('b','nm',r.name);applyLook(n,r.look,'var(--fg)');
    if(r.badge){const im=new Image();im.src=r.badge;im.alt='';row.append(im)}else row.append(h('i','nob'));
    row.append(n,h('small',null,r.builtin?'built in':(r.perms||[]).length+((r.perms||[]).length===1?' power':' powers')));row.onclick=()=>{RSEL=r.id;renderDash()};
    if(!r.builtin){
      const mv=(d)=>async e=>{e.stopPropagation();const ids=roles.filter(x=>!x.builtin).map(x=>x.id),j=ids.indexOf(r.id),k=j+d;if(k<0||k>=ids.length)return;[ids[j],ids[k]]=[ids[k],ids[j]];if(!dErr(await aterApi('/api/mod/roles/order',{ids})))renderDash()};
      const up=h('span','mv','↑');up.title='Move up';up.onclick=mv(-1);const dn=h('span','mv','↓');dn.title='Move down';dn.onclick=mv(1);row.append(up,dn);
    }
    list.append(row);void i;
  }
  const nb=dBtn('New role','btn-p',()=>{RSEL='new';renderDash()});list.append(nb);
  roleEditor(ed,RSEL==='new'?null:ATER.roles.get(RSEL));
}
function roleEditor(ed,r){
  const isNew=!r,locked=r&&r.builtin&&!dOwner();
  const st={name:r?r.name:'',look:{kind:'gradient',c1:'#a855f7',c2:'#ec4899',c3:'',glow:'#a855f7',...((r&&r.look)||{})},perms:new Set(r?r.perms||[]:['timeout']),timeoutMin:r?r.timeoutMin||10:10};
  if(isNew&&st.look.kind==='none')st.look.kind='solid';
  ed.append(h('h3',null,isNew?'New role':r.builtin?r.name+' (built in)':'Edit '+r.name));
  const prev=h('div','dprev');const draw=()=>{prev.replaceChildren();const line=h('div','msg');line.append(aterBadgeEl());if(r&&r.badge){const s=h('span','bd rb');const im=new Image();im.src=r.badge;s.append(im);line.append(s)}const n=h('b','nm',ME||'you');applyLook(n,st.look,colorFor(ME||'you'));line.append(n,': ','looking good in chat ');for(const t of aterTokens('AterW'))line.append(typeof t==='string'?t:emoteEl(t));prev.replaceChildren(line)};
  const name=h('input');name.value=st.name;name.maxLength=24;name.placeholder='Role name, e.g. Emote editor';name.disabled=locked;name.oninput=()=>st.name=name.value;
  ed.append(h('label','dl','Name'),name);
  ed.append(h('label','dl','Name look'));
  const seg=h('div','seg wrap');for(const[k,l]of LOOK_KINDS){const b=h('button',st.look.kind===k?'on':'',l);b.type='button';b.disabled=locked;b.onclick=()=>{st.look.kind=k;[...seg.children].forEach(x=>x.classList.toggle('on',x===b));colors();draw()};seg.append(b)}
  ed.append(seg);
  const cbox=h('div','dcols');const colors=()=>{cbox.replaceChildren();const k=st.look.kind;if(k==='none')return;const add=(key,label)=>{const l=h('label','cl',label);const i=h('input');i.type='color';i.value=st.look[key]||'#ffffff';i.disabled=locked;i.oninput=()=>{st.look[key]=i.value;draw()};l.append(i);cbox.append(l)};
    add('c1',k==='solid'||k==='glow'||k==='outline'||k==='glass'?'Colour':'From');if(k==='gradient'||k==='shimmer'){add('c2','To');const l=h('label','cl','Third');const c=h('input');c.type='checkbox';c.checked=!!st.look.c3;c.disabled=locked;c.onchange=()=>{st.look.c3=c.checked?'#f97316':'';colors();draw()};l.append(c);cbox.append(l);if(st.look.c3)add('c3','Third colour')}if(k==='glow')add('glow','Glow')};
  colors();ed.append(cbox);
  ed.append(h('label','dl','Preview'),prev);draw();
  if(r){
    const br=h('div','row2');br.append(h('span','hint','Badge: square images are fitted to the badge size automatically; small GIFs stay animated.'));
    br.append(dBtn(r.badge?'Change badge':'Add badge','btn-o',async()=>{const d=await pickImage('badge');if(!d)return;if(!dErr(await aterApi('/api/mod/roles/badge',{id:r.id,data:d})))toast('Badge saved','')}));
    if(r.badge)br.append(dBtn('Remove badge','',async()=>{if(!dErr(await aterApi('/api/mod/roles/badge',{id:r.id,clear:true})))toast('Badge removed','')}));
    if(locked)[...br.querySelectorAll('button')].forEach(b=>b.disabled=true);
    ed.append(br);
  }
  if(!r||!r.builtin){
    ed.append(h('label','dl','Powers'));
    const pg=h('div','dperms');
    for(const[k,[t,d]]of Object.entries(PERM_TXT)){const l=h('label','dperm');const c=h('input');c.type='checkbox';c.checked=st.perms.has(k);c.onchange=()=>{c.checked?st.perms.add(k):st.perms.delete(k);tm.hidden=!st.perms.has('timeout')};const tx=h('span');tx.append(h('b',null,t),h('small',null,d));l.append(c,tx);pg.append(l)}
    ed.append(pg);
    const tm=h('label','dl');const rng=h('input');rng.type='range';rng.min=1;rng.max=60;rng.value=st.timeoutMin;const tv=h('b',null,durTxt(st.timeoutMin));rng.oninput=()=>{st.timeoutMin=+rng.value;tv.textContent=durTxt(st.timeoutMin)};
    tm.append('Longest timeout this role can give: ',tv,rng);tm.hidden=!st.perms.has('timeout');ed.append(tm);
  }else ed.append(h('p','hint',r.id==='owner'?'The admin can do everything, including making moderators.':'Moderators can do everything except make other moderators, and can create the roles above.'));
  const a=h('div','row2');a.style.marginTop='14px';
  a.append(dBtn(isNew?'Create role':'Save','btn-p',async()=>{
    const q=await aterApi('/api/mod/roles/save',{id:r&&r.id,name:st.name,look:st.look,perms:Object.fromEntries([...st.perms].map(p=>[p,true])),timeoutMin:st.timeoutMin});
    if(dErr(q))return;RSEL=q.role.id;if(!ATER.roles.has(RSEL))ATER.roles.set(RSEL,q.role);renderDash();toast(isNew?'Role created':'Saved',q.role.name);
  }));
  if(r&&!r.builtin)a.append(dBtn('Delete role','btn-o danger',async()=>{if(!confirm('Delete the '+r.name+' role? Everyone who has it loses it.'))return;if(!dErr(await aterApi('/api/mod/roles/delete',{id:r.id}))){RSEL=null;toast('Role deleted',r.name)}}));
  if(locked)[...a.querySelectorAll('button')].forEach(b=>b.disabled=true);
  ed.append(a);
}

/* ---- emotes ---- */
function dEmotes(main){
  main.append(h('h2','dh','Emotes'));
  const up=h('div','row2');const en=h('input');en.placeholder='EmoteName';en.maxLength=24;
  up.append(en,dBtn('Upload image…','btn-p',async()=>{if(!/^[A-Za-z][A-Za-z0-9_]{1,23}$/.test(en.value.trim()))return toast('Name it first','2 to 24 letters, numbers or _, starting with a letter.');const d=await pickImage('emote');if(!d)return;if(!dErr(await aterApi('/api/emote',{name:en.value.trim(),data:d}))){en.value='';toast('Emote added','')}}));
  const s7=h('div','row2');const sn=h('input');sn.placeholder='Name';sn.maxLength=24;const sl=h('input');sl.placeholder='7TV emote link';
  s7.append(sn,sl,dBtn('Add from 7TV','btn-o',async()=>{if(!dErr(await aterApi('/api/emote',{name:sn.value.trim(),link:sl.value.trim()}))){sn.value='';sl.value='';toast('Emote added','')}}));
  main.append(dCard('Add an emote',h('p','hint','Images are resized to emote size (112 px tall) before they upload. Small GIFs stay animated.'),up,s7));
  const mine=(ATER.list||[]).filter(e=>!e.b),g=h('div','demotes');
  if(!mine.length)g.append(h('div','empty','No custom emotes yet.'));
  for(const e of mine){const c=h('div','dem');const im=new Image();im.src=ATER.emotes.get(e.name);im.alt=e.name;c.append(im,h('b',null,e.name),h('small',null,(e.set==='7tv'?'7TV · ':'')+(e.by?'by '+e.by:'')));c.append(dBtn('Remove','',async()=>{if(confirm('Remove '+e.name+'?')&&!dErr(await aterApi('/api/emote/remove',{name:e.name})))toast('Removed',e.name)}));g.append(c)}
  main.append(dCard('Custom emotes',g));
  const b=h('div','demotes small');for(const e of(ATER.list||[]).filter(e=>e.b)){const c=h('div','dem');const im=new Image();im.src=ATER.emotes.get(e.name);im.alt=e.name;im.loading='lazy';c.append(im,h('small',null,e.name));b.append(c)}
  main.append(dCard('Built in (Ater and the Ater 7TV set)',b));
}

/* ---- bans & timeouts ---- */
async function dBans(main){
  main.append(h('h2','dh','Bans & timeouts'));
  const t=myTimeouts();
  if(t.length){const f=h('div','row2');const n=h('input');n.placeholder='Name';const s=h('select');t.forEach(m=>s.append(new Option(durTxt(m),m)));f.append(n,s,dBtn('Time out','btn-p',async()=>{if(!dErr(await aterApi('/api/mod/timeout',{name:n.value.trim(),minutes:+s.value}))){n.value='';renderDash()}}));main.append(dCard('Time someone out',f))}
  if(dMod()){const f=h('div','row2');const n=h('input');n.placeholder='Name';const w=h('input');w.placeholder='Reason (optional)';f.append(n,w,dBtn('Ban','btn-o danger',async()=>{if(!n.value.trim()||!confirm('Ban '+n.value.trim()+'?'))return;if(!dErr(await aterApi('/api/mod/ban',{name:n.value.trim(),why:w.value})))renderDash()}));main.append(dCard('Ban someone',f))}
  const r=await aterApi('/api/mod/bans');if(dErr(r))return;
  const tl=h('div','dlist');if(!r.timeouts.length)tl.append(h('div','empty','Nobody is timed out.'));
  for(const x of r.timeouts){const row=h('div','drow');row.append(nameLine(x),h('span','dst','for '+untilStr(x.until-Date.now())),t.length?dBtn('Lift','',async()=>{if(!dErr(await aterApi('/api/mod/unmute',{name:x.name})))renderDash()}):'');tl.append(row)}
  main.append(dCard('Timed out',tl));
  const bl=h('div','dlist');if(!r.bans.length)bl.append(h('div','empty','Nobody is banned.'));
  for(const x of r.bans){const row=h('div','drow');row.append(nameLine(x),h('span','dst','by '+x.by+' · '+ago(x.ts)+(x.why?' · “'+x.why+'”':'')),dMod()?dBtn('Unban','',async()=>{if(!dErr(await aterApi('/api/mod/unban',{name:x.name})))renderDash()}):'');bl.append(row)}
  main.append(dCard('Banned',bl));
}

/* ---- polls ---- */
async function dPolls(main){
  main.append(h('h2','dh','Polls'));
  const f=h('div','dpoll');const q=h('input');q.placeholder='Question';q.maxLength=200;const opts=h('div','popts');
  const addOpt=v=>{const i=h('input');i.placeholder='Option';i.maxLength=80;i.value=v||'';opts.append(i)};addOpt();addOpt();
  const s=h('select');[[30,'30 seconds'],[60,'1 minute'],[120,'2 minutes'],[300,'5 minutes'],[900,'15 minutes']].forEach(([v,l])=>s.append(new Option(l,v)));s.value='60';
  const row=h('div','row2');row.append(dBtn('Add option','',()=>{if(opts.children.length<8)addOpt()}),s,dBtn('Start poll','btn-p',async()=>{const o=[...opts.querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);if(!dErr(await aterApi('/api/poll',{q:q.value.trim(),opts:o,secs:+s.value}))){toast('Poll started','');renderDash()}}));
  f.append(q,opts,row);main.append(dCard('Start a poll',f));
  if(ATER.poll&&!ATER.poll.done)main.append(dCard('Running now',h('p',null,ATER.poll.q+' · '+ATER.poll.total+' votes'),dBtn('End it now','btn-o',async()=>{dErr(await aterApi('/api/poll/end',{}));setTimeout(renderDash,400)})));
  const r=await aterApi('/api/mod/polls');if(dErr(r))return;
  const box=h('div','dlist');if(!r.polls.length)box.append(h('div','empty','Finished polls show up here.'));
  for(const p of r.polls){const c=h('div','phist');const max=Math.max(1,...p.opts.map(o=>o.n));c.append(h('b',null,p.q),h('small',null,p.total+' votes · by '+p.by+' · '+ago(p.ended)));
    for(const o of p.opts){const l=h('div','pbar'+(o.n===max&&o.n>0?' win':''));const i=h('i');i.style.width=(p.total?o.n/p.total*100:0)+'%';l.append(i,h('span',null,o.t),h('em',null,o.n+''));c.append(l)}box.append(c)}
  main.append(dCard('History',box));
}

/* ---- rooms ---- */
function dRooms(main){
  main.append(h('h2','dh','Rooms'),h('p','hint','Rooms show as tabs above the chat and in the home page chat panel. Live chat is where platform chats and the Big Screen live.'));
  const roleOpts=[...ATER.roles.values()].filter(r=>!r.builtin);
  const form=(r)=>{
    const c=h('div','droom');const n=h('input');n.value=r?r.name:'';n.placeholder='Room name, e.g. general';n.maxLength=24;const tp=h('input');tp.value=r?r.topic||'':'';tp.placeholder='Topic (optional)';tp.maxLength=120;
    const view=h('select');view.append(new Option('Anyone can read','everyone'),new Option('Signed-in people can read','signedin'));view.value=r?r.view||'everyone':'signedin';
    const post=h('select');post.append(new Option('Anyone signed in can post','everyone'),new Option('The mod team can post','staff'),new Option('Only moderators can post','mods'),...roleOpts.map(x=>new Option('Only '+x.name+' can post','role:'+x.id)));post.value=r?r.post||'everyone':'everyone';
    if(r&&r.builtin){view.disabled=post.disabled=true}
    const a=h('div','row2');a.append(dBtn(r?'Save':'Add room','btn-p',async()=>{if(!dErr(await aterApi('/api/mod/rooms/save',{id:r&&r.id,name:n.value,topic:tp.value,view:view.value,post:post.value})))toast(r?'Saved':'Room added','')}));
    if(r&&!r.builtin)a.append(dBtn('Delete','btn-o danger',async()=>{if(confirm('Delete #'+r.name+'? Its messages go too.')&&!dErr(await aterApi('/api/mod/rooms/delete',{id:r.id})))toast('Room deleted','')}));
    const t=h('div','row2');t.append(n,tp);const s=h('div','row2');s.append(view,post);c.append(t,s,a);return c;
  };
  for(const r of ATER.rooms)main.append(dCard('#'+r.name+(r.builtin?' (built in)':''),form(r)));
  if(ATER.rooms.length<10)main.append(dCard('New room',form(null)));
}

/* ---- mod log ---- */
async function dLog(main){
  main.append(h('h2','dh','Mod log'));
  const q=h('input');q.placeholder='Filter by moderator, action or name';main.append(q);
  const r=await aterApi('/api/mod/log');if(dErr(r))return;
  const box=h('div','dlist log');main.append(box);
  const draw=()=>{box.replaceChildren();const f=q.value.toLowerCase();const l=r.log.filter(e=>!f||[e.by,e.act,e.target,e.detail,ACT[e.act]].join(' ').toLowerCase().includes(f));if(!l.length)box.append(h('div','empty','Nothing matches.'));for(const e of l)box.append(logRow(e))};
  q.oninput=draw;draw();
}

/* ---- chat settings ---- */
async function dSettings(main){
  main.append(h('h2','dh','Chat settings'));
  if(dMod()){
    const s=ATER.settings||{};const slow=h('select');[[0,'Off'],[3,'3 seconds'],[5,'5 seconds'],[10,'10 seconds'],[30,'30 seconds'],[60,'1 minute']].forEach(([v,l])=>slow.append(new Option(l,v)));slow.value=String(s.slow||0);
    const lw=h('input');lw.type='number';lw.min=0;lw.max=1440;lw.value=s.linkWait??10;lw.style.width='90px';
    const r=h('div','row2');const l1=h('label','cl','Slow mode');l1.append(slow);const l2=h('label','cl','New accounts wait (minutes) before posting links');l2.append(lw);
    r.append(l1,l2,dBtn('Save','btn-p',async()=>{const q=await aterApi('/api/mod/settings',{slow:+slow.value,linkWait:+lw.value});if(!dErr(q))toast('Saved','')}));
    main.append(dCard('Chat',r));
  }
  if(dHas('words')){
    const box=h('div');const draw=async()=>{const q=await aterApi('/api/mod/filter',{op:'list'});box.replaceChildren();const w=h('div','words');for(const x of q.words||[]){const s2=h('span',null,x),rm=h('button',null,'✕');rm.onclick=async()=>{await aterApi('/api/mod/filter',{op:'remove',words:[x]});draw()};s2.append(rm);w.append(s2)}box.append((q.words||[]).length?w:h('div','empty','No blocked words.'))};
    const f=h('div','row2');const i=h('input');i.placeholder='Words to block, separated by spaces';f.append(i,dBtn('Block','btn-p',async()=>{if(!i.value.trim())return;const q=await aterApi('/api/mod/filter',{op:'add',words:i.value.trim().split(/\s+/)});if(!dErr(q)){i.value='';draw()}}));
    main.append(dCard('Blocked words',h('p','hint','Messages and DMs with these whole words are refused. Moderators are exempt.'),f,box));draw();
  }
  if(dHas('feature')){
    const pk=ATER.featured;const cur=h('p',null,pk?'Now: '+pk.u+' on '+(PLAT[pk.p]||{l:pk.p}).l+(pk.note?' · '+pk.note:'')+' (by '+pk.by+')':'Nothing is picked. When '+CONFIG.name+' is offline, viewers see their own list.');
    const f=h('div','row2');const p=h('select');['twitch','kick','youtube','rumble','angelthump'].forEach(x=>p.append(new Option(PLAT[x].l,x)));const u=h('input');u.placeholder='Channel';const n=h('input');n.placeholder='Note (optional)';
    f.append(p,u,n,dBtn('Set Ater pick','btn-p',async()=>{if(!dErr(await aterApi('/api/feature',{p:p.value,u:u.value.trim(),note:n.value})))toast('Ater pick set','')}));
    main.append(dCard('Ater pick',cur,f,pk?dBtn('Clear the pick','btn-o',async()=>{dErr(await aterApi('/api/feature',{clear:true}))}):null));
  }
}
