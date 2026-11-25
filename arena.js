import {node,button,qrCanvas,safeColor,csv,download,soundboard} from './arena-tools.js';

const pendingInvites = new Map();
const phases = {
  lobby:['Tournament lobby','ردهة البطولة'],match_ready:['Match ready','المباراة جاهزة'],
  category:['Choose a category','اختر فئة'],card:['Choose a mystery card','اختر بطاقة غامضة'],
  active:['Question in play','السؤال جارٍ'],paused:['Timer paused','المؤقت متوقف مؤقتاً'],
  locked:['Answer locked','تم تثبيت الإجابة'],expired:['Time expired','انتهى الوقت'],
  revealed:['Answer revealed','تم كشف الإجابة'],exhausted:['More questions needed','يلزم توفير أسئلة إضافية'],
  completed:['Tournament complete','اكتملت البطولة'],cancelled:['Tournament ended','أُنهِيت البطولة'],
  suspended:['Tournament paused','البطولة متوقفة مؤقتاً']
};
const labels = {
  ready:['Upcoming','قادمة'],pending:['Upcoming','قادمة'],waiting:['Waiting','في الانتظار'],
  active:['In play','جارية'],playing:['In play','جارية'],completed:['Completed','مكتملة'],
  done:['Completed','مكتملة'],bye:['Bye','تأهل تلقائي'],eliminated:['Eliminated','خرج من المنافسة'],
  disqualified:['Disqualified','مستبعد'],withdrawn:['Withdrawn','منسحب'],champion:['Champion','البطل'],
  advanced:['Advanced','متأهل'],winner:['Winner','الفائز'],qualified:['Qualified','متأهل'],queued:['Upcoming','قادمة'],third:['Third place','المركز الثالث'],runner_up:['Runner-up','الوصيف'],bronze:['Third place','المركز الثالث'],walkover:['Walkover','فوز بالانسحاب'],void:['Void','ملغاة']
};
const events = {
  start:['Tournament started','بدأت البطولة'],start_match:['Match started','بدأت المباراة'],
  category:['Category selected','اختيرت الفئة'],card:['Question selected','اختير السؤال'],lock:['Answer locked','تم تثبيت الإجابة'],
  reveal:['Answer revealed','كُشفت الإجابة'],next:['Turn advanced','انتقل الدور'],pause:['Timer paused','أُوقف المؤقت'],
  resume:['Play resumed','استؤنف اللعب'],skip:['Question replaced','استُبدل السؤال'],adjust:['Score adjusted','عُدلت النقاط'],
  restart:['Match restarted','أُعيدت المباراة'],disqualify:['Team disqualified','استُبعد فريق'],cancel:['Tournament ended','أُنهِيت البطولة'],
  credentials:['Credentials issued','أُصدرت بيانات الانضمام'],revoke:['Device revoked','أُلغي تصريح الجهاز'],
  rename:['Team updated','عُدلت بيانات الفريق'],suspend:['Tournament suspended','عُلقت البطولة'],
  retry:['Question allocation retried','أُعيدت محاولة تخصيص الأسئلة']
};
const cacheRead = (store,key) => {try{return store.getItem(key);}catch{return null;}};
const cacheWrite = (store,key,value) => {try{store.setItem(key,value);}catch{/* An in-memory credential works until reload. */}};

export async function mountArena(ctx, route) {
  const {root,t,rpc,sdk} = ctx;
  const [mode,rawCode,teamId,initialSecret] = String(route).replace(/^#?\/?/,'').split('/');
  const code = String(rawCode || '').toUpperCase();
  const ar = ctx.lang === 'ar';
  const format = new Intl.NumberFormat(ar ? 'ar-AE' : 'en-AE');
  const number = value => format.format(Number(value)||0);
  const textFor = (dict,key) => dict[key] ? t(...dict[key]) : String(key||'');
  const frame = node('section','arena ar-'+mode);
  frame.dir = ar ? 'rtl' : 'ltr';
  frame.lang = ar ? 'ar' : 'en';
  frame.dataset.motion=String(ctx.settings?.animations!==false);
  root.replaceChildren(frame);
  const content = node('div'), announce=node('div','ar-live'), info = node('p','ar-error'), overlays = node('div');
  info.setAttribute('role','alert');
  announce.setAttribute('role','status');announce.setAttribute('aria-live','polite');
  frame.append(content,announce,info,overlays);
  const scope = new AbortController();
  const audio = soundboard();
  let state, pending = false, channel, poll = 0, ticker = 0, closed = false, loading = false, repeat = false;
  let lastOK = 0, subscribed = false, failed = false, lastSeen = 0, serverAt = 0, sampledAt = 0;
  let choice = null, choiceKey = '', clockEl, lockEl, revealEl, netEl, seenSeconds;
  let refreshDue = 0, currentDialog;
  const inviteRoute=code+':'+teamId;
  if(initialSecret)pendingInvites.set(inviteRoute,initialSecret);
  let secret=initialSecret || pendingInvites.get(inviteRoute) || '';
  const deviceKey = 'trivia:device:'+code+':'+teamId;
  let device = mode === 'team' ? cacheRead(localStorage,deviceKey) : null;
  let inviteInMemory = new Map();
  const alive = () => !closed && frame.isConnected && !ctx.signal?.aborted;
  const phaseName = p => textFor(phases,p);
  const team = id => (state?.teams || []).find(x=>x.id===id);
  const teamName = id => team(id)?.name || t('To be decided','يُحدد لاحقاً');
  const localized = (item,language=ctx.lang) => {
    if (typeof item === 'string') return item;
    if (!item) return '';
    const key = language === 'ar' ? 'ar' : 'en';
    return item[key] || (item[key==='ar'?'en':'ar'] ? (key==='ar'?'[English] ':'[العربية] ')+item[key==='ar'?'en':'ar'] : '');
  };
  const heading = (label, ...rest) => node('section','ar-panel',node('h2','',label),...rest);
  const badge = label => node('span','ar-badge',label);
  const actionButton = (label,fn,kind) => button(label,()=>Promise.resolve().then(fn).catch(report),kind);
  const gameURL = path => {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '/' + path.split('/').map(encodeURIComponent).join('/');
    return url.href;
  };
  const errors=[
    [/Session changed/i,'Another device changed the game. Check the current turn and retry.','تغيرت حالة اللعبة من جهاز آخر. راجع الدور الحالي وحاول مجدداً.'],
    [/already assigned/i,'An answering device is already connected. Select read-only access or ask the manager to release it.','يوجد جهاز إجابة متصل. اختر المشاهدة أو اطلب من المدير إلغاء تصريح الجهاز السابق.'],
    [/invalid or unavailable credentials|access unavailable/i,'Check the private link and PIN. Repeated incorrect PINs require a short wait.','تحقق من الرابط الخاص والرمز. عند تكرار الخطأ انتظر قليلاً قبل المحاولة.'],
    [/Device limit/i,'This team has reached the device limit. Ask the manager to release old devices.','بلغ الفريق الحد الأقصى للأجهزة. اطلب من المدير إلغاء تصاريح الأجهزة القديمة.'],
    [/Answering device required/i,'An authorized device for the active team is required.','يلزم استخدام جهاز معتمد للفريق صاحب الدور.'],
    [/Insufficient eligible questions/i,'Too few eligible questions. Add questions, broaden filters or reduce questions per team.','رصيد الأسئلة المؤهلة غير كافٍ. أضف أسئلة أو وسّع الفئات أو قلّل عدد أسئلة الفريق.'],
    [/time expired/i,'The deadline passed before the answer was locked.','انتهت المهلة قبل تثبيت الإجابة.'],
    [/action unavailable/i,'This action is unavailable at this stage.','هذا الإجراء غير متاح في المرحلة الحالية.'],
    [/Session unavailable|session manager required|access denied/i,'Session access is unavailable. Check the invitation or manager account.','يتعذّر الوصول للجلسة. تحقق من الدعوة أو حساب مدير الجلسة.'],
    [/fetch|network/i,'The connection was interrupted. Try again when connected.','انقطع الاتصال. أعد المحاولة عند عودة الشبكة.']
  ];
  function errorText(error) {
    const message=String(error?.message || error?.error || error || '');
    const entry=errors.find(([pattern])=>pattern.test(message));
    return entry?t(entry[1],entry[2]):message;
  }
  function report(error) {
    if (!alive()) return;
    const message=errorText(error);
    info.textContent = t('Action could not be completed. ','تعذّر تنفيذ الإجراء. ')+message;
  }
  function close() {
    if (closed) return;
    closed = true; scope.abort();
    clearTimeout(poll); clearTimeout(refreshDue); clearInterval(ticker);
    if (channel) void sdk.removeChannel(channel);
    currentDialog?.close();
    audio.stop(); secret=''; inviteInMemory.clear();
  }
  ctx.signal?.addEventListener('abort',close,{once:true});
  if (initialSecret && mode==='team') history.replaceState(history.state,'',gameURL('team/'+code+'/'+teamId));
  if (!/^[A-Z0-9-]{3,24}$/.test(code) || !['manager','team','watch'].includes(mode) ||
      (mode==='team' && !/^[a-f0-9-]{36}$/i.test(teamId||''))) {
    content.append(heading(t('Invalid game link','رابط اللعبة غير صالح'),t('Open the link supplied by the host.','افتح الرابط الذي أرسله مدير الجلسة.')));
    return close;
  }

  function dialog(title,fill) {
    currentDialog?.close();
    const box = node('dialog','ar-modal');
    const form = node('form');
    form.noValidate = false;
    box.setAttribute('aria-label',title);
    const err = node('p','ar-error');err.setAttribute('role','alert');
    const actions = node('div','ar-actions');
    const cancel = button(t('Close','إغلاق'),()=>box.close());
    form.append(node('h2','',title));
    function submit(label,callback,kind='primary') {
      const b = button(label,()=>{},kind); b.type = 'submit'; actions.append(b);
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(b.disabled)return;b.disabled=true;err.textContent='';
        try {await callback(); if(box.open)box.close();}
        catch(error){err.textContent=t('Could not complete action. ','تعذّر إتمام الإجراء. ')+errorText(error);}
        finally {b.disabled=false;}
      });
    }
    fill(form,submit,box);
    actions.append(cancel);form.append(err,actions);box.append(form);overlays.append(box);
    box.addEventListener('close',()=>{
      box.remove(); if(currentDialog===box) currentDialog=null;
    },{once:true});
    currentDialog=box;box.showModal();
    return box;
  }
  function field(form,label,type,value='',attrs={}) {
    const input = node('input');input.type=type;input.value=value;
    for(const [k,v] of Object.entries(attrs)) input.setAttribute(k,v);
    form.append(node('label','ar-field',label,input));return input;
  }
  function share(title,url,pin) {
    dialog(title,form=>{
      form.append(qrCanvas(url,title));
      const value = field(form,t('Joining link','رابط الانضمام'),'text',url,{readonly:'',dir:'ltr'});
      if(pin) form.append(node('p','ar-banner',t('Team PIN','رمز الفريق')+' · ',node('bdi','',pin)));
      const status=node('small');
      form.append(actionButton(t('Copy link','نسخ الرابط'),async()=>{
        try {await navigator.clipboard.writeText(url);status.textContent=t('Copied','تم النسخ');}
        catch {value.select();status.textContent=t('Select Copy on your device.','اختر «نسخ» على جهازك.');}
      }),status);
    });
  }
  function confirmAction(title, description, fn, kind='danger') {
    dialog(title,(form,submit)=>{form.append(node('p','',description));submit(t('Confirm','تأكيد'),fn,kind);});
  }
  async function command(name,data={},expected=state?.version) {
    if (!alive() || pending) throw Error(t('Wait for the current request.','انتظر اكتمال الطلب الجاري.'));
    pending=true; info.textContent='';
    try {
      const result=await rpc('trivia_act',{p_code:code,p_version:expected,p_action:name,p_data:data,p_device:device});
      if(result?.error) throw Error(result.error);
      await refresh();
      return result;
    } catch(e){void refresh();throw e;}
    finally {pending=false;}
  }
  function control(label,name,data={},kind='') {
    const expected=state.version;
    return actionButton(label,()=>command(name,data,expected),kind);
  }
  function confirmControl(label,name,help,data={}) {
    const expected=state.version;
    return actionButton(label,()=>confirmAction(label,help,()=>command(name,data,expected)),'danger');
  }
  function joinForm() {
    content.replaceChildren();const form=node('form','ar-panel ar-stack');
    form.append(node('h1','',t('Join your team','انضم إلى فريقك')),node('p','ar-sub',t('Enter the PIN shared by your game manager.','أدخل رمز PIN الذي شاركه معك مدير اللعبة.')));
    const token = secret ? null : field(form,t('Private joining key','مفتاح الانضمام الخاص'),'password','',{required:'',autocomplete:'off'});
    const pin = field(form,t('Team PIN','رمز الفريق'),'password','',{required:'',inputmode:'numeric',autocomplete:'off',maxlength:'16'});
    const read = node('input');read.type='checkbox';
    form.append(node('label','ar-row',read,t('Join as a read-only device','انضم كجهاز للمشاهدة فقط')));
    const join=button(t('Join team','انضم إلى الفريق'),()=>{},'primary');join.type='submit';form.append(join);content.append(form);
    form.addEventListener('submit',async e=>{
      e.preventDefault(); if(join.disabled)return;
      join.disabled=true;info.textContent='';
      try {
        const result=await rpc('trivia_join',{p_code:code,p_team:teamId,p_secret:secret||token?.value,p_pin:pin.value,p_readonly:read.checked});
        if(!result?.device) throw Error(result?.error || t('Check the link and PIN.','تحقق من الرابط والرمز.'));
        if(!alive())return;
        device=result.device;cacheWrite(localStorage,deviceKey,device);secret='';pendingInvites.delete(inviteRoute);form.remove();
        await refresh();schedule();
      }catch(error){report(error);}finally{join.disabled=false;}
    });
  }
  function serverNow() {return serverAt + Math.max(0,performance.now()-sampledAt);}
  function seconds() {
    if(state?.phase==='paused') return Math.max(0,Math.ceil(Number(state.remaining)||0));
    return Math.max(0,Math.ceil((Date.parse(state?.deadline)-serverNow())/1000)||0);
  }
  function phase() {return state.phase==='active' && state.deadline && !seconds() ? 'expired' : state.phase;}
  function connection() {
    if(!netEl) return;
    const interrupted=failed || !navigator.onLine;
    netEl.dataset.offline=String(interrupted);
    netEl.textContent=interrupted ? t('Connection interrupted · reconnecting','انقطع الاتصال · جارٍ إعادة الاتصال') :
      subscribed ? t('Live connection','متصل مباشرة') : t('Synchronizing periodically','تتم المزامنة دورياً');
  }
  function tick() {
    if(!alive()){close();return;}
    if(!state)return;
    const s=seconds(), p=phase();
    if(frame.dataset.phase!==p){render();}
    if(clockEl){
      clockEl.textContent=number(Math.floor(s/60))+':'+new Intl.NumberFormat(ar?'ar-AE':'en-AE',{minimumIntegerDigits:2}).format(s%60);
      clockEl.dataset.low=String(s<=10);
    }
    if(state.phase==='active' && s<=5 && s!==seenSeconds) audio.play(s?'warning':'expired');
    seenSeconds=s;
    if(lockEl) lockEl.disabled=p!=='active'||!choice||Boolean(failed);
    if(revealEl) revealEl.disabled=!['locked','expired'].includes(p);
  }
  function subscribe(id) {
    if(channel || !sdk?.channel || !id)return;
    const restricted=state.settings?.spectators===false;
    const invalidate=()=>{
      // Coalesce incoming invalidations; always fetch role-scoped data over RPC.
      if(refreshDue)return;
      refreshDue=setTimeout(()=>{refreshDue=0;void refresh();},120);
    };
    channel=restricted ? sdk.channel('trivia-refresh-'+id).on('broadcast',{event:'refresh'},invalidate) :
      sdk.channel('trivia-'+id+'-'+crypto.randomUUID()).on('postgres_changes',{event:'*',schema:'public',table:'trivia_pulses',filter:'id=eq.'+id},invalidate);
    channel=channel.subscribe(status=>{
        if(!alive())return;
        subscribed=status==='SUBSCRIBED';connection();schedule();
        if(subscribed)void refresh();
      });
  }
  function schedule() {
    clearTimeout(poll);
    if(!alive())return;
    const delay=document.hidden ? 45000 : failed ? 5500 : state?.settings?.spectators===false ? 4000 : subscribed ? 30000 : 6500;
    poll=setTimeout(async()=>{await refresh();schedule();},delay+Math.random()*650);
  }
  async function refresh() {
    if(!alive())return;
    if(loading){repeat=true;return;}
    loading=true;
    const begin=performance.now();
    try {
      const next=await rpc('trivia_state',{p_code:code,p_device:device});
      if(!alive())return;
      if(!next?.id || next.error)throw Error(next?.error || t('Session unavailable','الجلسة غير متاحة'));
      if(mode==='manager' && !next.manager)throw Error(t('Sign in as this tournament’s manager.','سجّل الدخول بحساب مدير هذه البطولة.'));
      if(mode==='team' && next.self!==teamId) {
        device=null;state=null;localStorage.removeItem(deviceKey);joinForm();
        throw Error(t('The manager must authorize this device again.','يجب على المدير إعادة اعتماد هذا الجهاز.'));
      }
      if(state && next.version<state.version)return;
      lastOK=Date.now();failed=false;const end=performance.now();
      const server=Date.parse(next.now);
      if(!Number.isFinite(server))throw Error(t('Server time unavailable','وقت الخادم غير متاح'));
      serverAt=server;sampledAt=(begin+end)/2;
      const old=state;state=next;
      subscribe(next.id);
      if(old?.version!==next.version || old?.phase!==next.phase || !lastSeen || old?.can_answer!==next.can_answer ||
         JSON.stringify(old?.teams)!==JSON.stringify(next.teams) || JSON.stringify(old?.team_devices)!==JSON.stringify(next.team_devices)){
        playTransition(old,next);render();
      }
      tick();connection(); lastSeen=lastOK;
    }catch(e){
      if(!alive())return;
      failed=true;connection();
      if(mode==='team' && device && /session unavailable|access denied/i.test(String(e?.message||e))) {
        device=null;localStorage.removeItem(deviceKey);state=null;joinForm();
      }
      else if(!state && mode==='team' && secret && device){device=null;joinForm();}
      else if(!state && !content.querySelector('form')) {
        content.replaceChildren(heading(t('Session unavailable','الجلسة غير متاحة'),
          node('p','',t('Check your connection and game link.','تحقق من الاتصال ورابط اللعبة.')),
          actionButton(t('Retry','إعادة المحاولة'),refresh),
          ...(mode==='team'?[actionButton(t('Authorize this device','اعتماد هذا الجهاز'),joinForm)]:[])));
      }
      if(!state)report(e);
    }finally{loading=false;if(repeat){repeat=false;void refresh();}}
  }
  function playTransition(old,next) {
    if(!old || old.version===next.version || next.settings?.sound===false)return;
    const byPhase={category:'start_match',card:'category',active:'card',locked:'locked',
      completed:'champion',match_ready:old.phase==='lobby'?'start':'victory'};
    if(next.phase==='revealed')audio.play(next.selected!=null && next.selected===next.correct?'correct':'incorrect');
    else if(next.phase!==old.phase)audio.play(byPhase[next.phase]);
  }
  function media(q,stage) {
    for (const type of ['image','audio']) {
      if (!q?.[type]) continue;
      const el=node(type==='image'?'img':'audio');el.hidden=true;
      if(type==='image')el.alt=t('Question illustration','صورة السؤال');else el.controls=true;
      stage.append(el);
      void import('./question-media.mjs').then(({resolveQuestionMedia})=>
        resolveQuestionMedia(ctx,q[type],{p_code:code,p_device:device})).then(value=>{
          if(!el.isConnected || !value)return;
          const url=new URL(value,location.href);
          if(url.protocol!=='https:' && !(url.origin===location.origin && ['localhost','127.0.0.1'].includes(url.hostname)))return;
          el.src=url.href;el.hidden=false;
        }).catch(()=>{if(el.isConnected)el.replaceWith(node('small','',t('Question media unavailable','وسائط السؤال غير متاحة')));});
    }
  }
  function tally(m) {
    const box=node('div','ar-scoreboard');
    for(const side of ['a','b']){
      const id=m[side], x=team(id);
      const active=id===state.active_team && !['completed','match_ready','lobby'].includes(state.phase);
      const s=node('div','ar-score',node('div','',node('strong','',x?.name||teamName(id)),
        node('small','',active?t('Active team','الفريق صاحب الدور'):id===teamId?t('Your team','فريقك'):t('Team','الفريق'))),
        node('b','',number(m['score_'+side])));
      s.style.setProperty('--team-color',safeColor(x?.color));s.dataset.active=String(active);box.append(s);
    }
    return box;
  }
  function waiting(m) {
    const player=team(teamId);
    if(mode!=='team'||!player)return null;
    let message;
    if(player.status==='disqualified')message=t('Your team has been disqualified. You can watch the tournament here.','استُبعد فريقك. يمكنك متابعة البطولة هنا.');
    else if(player.status==='eliminated')message=t('Your team has been eliminated. Follow the remaining matches here.','خرج فريقك من المنافسة. يمكنك متابعة المباريات المتبقية هنا.');
    else if(!m || ![m.a,m.b].includes(teamId)){
      const upcoming=state.matches.find(x=>[x.a,x.b].includes(teamId)&&!x.winner);
      message=upcoming?t('Your upcoming match','مباراتك المقبلة')+' · '+teamName(upcoming.a)+' × '+teamName(upcoming.b):
        t('Waiting for your match','في انتظار مباراة فريقك');
    } else if(state.can_answer===false)message=t('Read-only device · follow your team’s turn','جهاز مخصص للمشاهدة · تابع دور فريقك');
    else if(['category','card','active','paused','locked','expired','revealed'].includes(phase())) message=teamId===state.active_team?
      t('Your turn','دور فريقك'):t('Opponent’s turn','دور الفريق المنافس');
    return message?node('p','ar-banner',message):null;
  }
  function categoryName(key) {return (ar && state.categories?.find(x=>x.name===key)?.category_ar) || key || ''; }
  function choosePanel(stage,canPlay) {
    if(state.phase==='category'){
      const grid=node('div','ar-categories');
      for(const c of state.categories||[]){
        const label=ar ? c.category_ar || c.name : c.name;
        const el=node(canPlay&&c.count>0?'button':'div','ar-category',
          node('strong','',(c.icon?c.icon+' ':'')+label),node('small','',number(c.count)+' '+t('available','متاح')));
        el.style.setProperty('--team-color',safeColor(c.color));
        if(el.tagName==='BUTTON'){el.type='button';el.onclick=()=>command('category',{category:c.name}).catch(report);}
        else el.setAttribute('aria-disabled','true');
        grid.append(el);
      }
      stage.append(grid);
    }else{
      stage.append(node('p','ar-sub',categoryName(state.category)));
      const grid=node('div','ar-cards');
      for(const card of state.cards||[]){
        const el=node(canPlay?'button':'div','ar-card',number(card));
        el.setAttribute('aria-label',t('Mystery question','السؤال الغامض')+' '+number(card));
        if(canPlay){el.type='button';el.onclick=()=>command('card',{card}).catch(report);}
        else el.setAttribute('aria-disabled','true');
        grid.append(el);
      }
      stage.append(grid);
    }
  }
  function question(stage,p,canPlay) {
    const q=state.question, language=state.settings?.language || ctx.lang;
    if(!q)return;
    const row=node('div','ar-meta',badge(phaseName(p)),state.category?badge(categoryName(state.category)):null);
    if(['active','expired','paused'].includes(p)){clockEl=node('span','ar-timer');clockEl.setAttribute('role','timer');row.append(clockEl);}
    const title=node('h2','ar-prompt',localized(q,language));title.dir=language==='ar'?'rtl':'ltr';
    stage.append(row,title);media(q,stage);
    const choose=p==='active'&&canPlay;
    const grid=node('div','ar-choices'),opts=q.options||[];
    const key=String(state.match_id)+'/'+state.turn_no+'/'+q.en+'/'+q.ar;
    if(key!==choiceKey){choice=null;choiceKey=key;}
    const committed=state.selected!=null && ['locked','revealed'].includes(p);
    for(const [i,o] of opts.entries()){
      const chosen=committed?state.selected===o.id:choose && choice===o.id;
      const el=node(choose?'button':'div','ar-option',
        node('span','ar-letter',ar?['أ','ب','ج','د','هـ','و'][i]:String.fromCharCode(65+i)),node('span','',localized(o,language)));
      if(p==='revealed' && (o.id===state.correct || o.id===state.selected)){
        const right=o.id===state.correct;el.dataset.result=right?'correct':'incorrect';
        el.append(node('strong','ar-result-label',right?t('✓ Correct answer','✓ الإجابة الصحيحة'):t('✕ Locked answer','✕ الإجابة المثبتة')));
      }
      if(choose){el.type='button';el.setAttribute('aria-pressed',String(chosen));el.onclick=()=>{
        if(phase()!=='active'||failed)return;
        choice=o.id;
        for(const item of grid.children)item.setAttribute('aria-pressed',String(item===el));
        if(lockEl)lockEl.disabled=false;
      };}
      else if(chosen && p==='locked')el.append(node('strong','ar-result-label',t('Locked','مثبتة')));
      grid.append(el);
    }
    stage.append(grid);
    if(choose){
      const expected=state.version;
      lockEl=actionButton(t('Lock answer','ثبّت الإجابة'),()=>{
        const answer=choice, selected=opts.find(o=>o.id===answer);
        if(!selected||phase()!=='active')return;
        confirmAction(t('Lock this answer?','هل تريد تثبيت هذه الإجابة؟'),
          localized(selected,language)+' · '+t('Your answer becomes final.','ستصبح إجابتك نهائية.'),
          ()=>command('lock',{answer},expected),'primary');
      },'primary');
      lockEl.disabled=!choice;stage.append(lockEl);
    } else if(['locked','expired'].includes(p))stage.append(node('p','ar-banner',t('Waiting for the manager to reveal the answer.','في انتظار كشف المدير عن الإجابة.')));
    if(p==='revealed'){
      const correct=state.selected!=null && state.selected===state.correct;
      stage.append(node('strong','ar-banner',state.selected==null?t('Time expired · no locked answer','انتهى الوقت · لم تُثبّت إجابة'):
        correct?t('Correct answer','إجابة صحيحة'):t('Incorrect answer','إجابة غير صحيحة')));
      const explanation=localized(state.explanation,language);
      if(explanation)stage.append(node('p','',explanation));
    }
  }
  function gameView(m) {
    const p=phase(),stage=node('section','ar-stage'), canPlay=mode==='team'&&state.self===teamId&&teamId===state.active_team&&state.can_answer!==false;
    if(['active','paused','locked','expired','revealed'].includes(p))question(stage,p,canPlay);
    else if(p==='completed'){
      stage.classList.add('ar-finish');
      stage.append(node('p','ar-kicker',t('Tournament champion','بطل البطولة')),node('h2','',teamName(state.champion)));
    }else{
      stage.append(node('h2','ar-prompt',phaseName(p)));
      if(['category','card'].includes(p)){
        if(!canPlay)stage.append(node('p','ar-sub',t('Choosing now','يختار الآن')+' · '+teamName(state.active_team)));
        choosePanel(stage,canPlay);
      }
      if(p==='lobby')stage.append(node('p','ar-sub',t('Teams can join now. The manager will start the tournament.','يمكن للفرق الانضمام الآن. سيبدأ المدير البطولة.')),
        node('div','ar-tools',...(state.teams||[]).map(x=>badge((x.icon?x.icon+' ':'')+x.name))));
      if(p==='match_ready')stage.append(node('p','ar-sub',t('The next match starts when the manager is ready.','تبدأ المباراة التالية عندما يكون المدير جاهزاً.')));
      if(p==='exhausted')stage.append(node('p','ar-banner',t('The bank has run out of eligible questions. The manager can add eligible questions and retry.','نفدت الأسئلة المؤهلة. يمكن للمدير إضافة أسئلة ملائمة ثم إعادة المحاولة.')));
    }
    const primary=node('div','ar-primary');
    if(m){
      primary.append(node('div','ar-meta',badge(t('Round','الجولة')+' '+number(m.round_no)),
        state.sudden?badge(t('Sudden death','الموت المفاجئ')):state.turn_no && state.phase!=='match_ready'?
          badge(t('Question','السؤال')+' '+number(state.turn_no)+' / '+number(2*(state.settings?.questions||5))):null),
        tally(m));
    }
    const last=[...(state.matches||[])].filter(x=>x.finished_at&&x.winner&&x.status!=='bye').sort((a,b)=>Date.parse(b.finished_at)-Date.parse(a.finished_at))[0];
    if(last && ['match_ready','completed'].includes(p)){
      const mine=mode==='team' && [last.a,last.b].includes(teamId);
      primary.append(node('p','ar-banner',mine ? (last.winner===teamId?t('Your team won its match','فاز فريقك بالمباراة'):t('Your team lost its match','خسر فريقك المباراة')) :
        t('Match winner','الفائز بالمباراة')+' · '+teamName(last.winner)));
    }
    const note=waiting(m);if(note && !['completed','cancelled'].includes(p))primary.append(note);
    primary.append(stage);
    return primary;
  }
  function bracket() {
    const d=node('details','ar-bracket',node('summary','',t('Tournament bracket','مخطط البطولة')));
    d.open=['completed','lobby','match_ready'].includes(state.phase)||mode==='manager';
    const rounds=new Map();
    for(const m of state.matches||[]){
      if(!rounds.has(m.round_no))rounds.set(m.round_no,[]);
      rounds.get(m.round_no).push(m);
    }
    const grid=node('div','ar-rounds');
    for(const [r,matches] of rounds){
      const col=node('div','ar-round',node('h3','',t('Round','الجولة')+' '+number(r)));
      for(const m of matches){
        const title=m.third || m.kind==='bronze' ? t('Third place','المركز الثالث') : textFor(labels,m.status);
        col.append(node('div','ar-match',node('small','',title),
          node('strong','',teamName(m.a)+' · '+number(m.score_a)),node('strong','',teamName(m.b)+' · '+number(m.score_b)),
          m.winner?node('small','',t('Winner','الفائز')+' · '+teamName(m.winner)):null));
      }
      grid.append(col);
    }
    d.append(grid);
    if(!rounds.size)d.append(node('p','ar-sub',t('Pairings appear when the tournament starts.','تظهر المواجهات عند بدء البطولة.')));
    return d;
  }
  function managerControls(m) {
    const p=phase(), panel=heading(t('Game controls','أدوات إدارة اللعبة'));
    const actions=node('div','ar-actions'), expected=state.version;
    if(p==='lobby')actions.append(actionButton(t('Configure session','إعدادات الجلسة'),()=>ctx.go('configure/'+code)),control(t('Start tournament','بدء البطولة'),'start',{},'primary'));
    if(p==='match_ready')actions.append(control(t('Start match','بدء المباراة'),'start_match',{},'primary'));
    if(['active','locked','expired'].includes(p)){
      revealEl=control(t('Reveal answer','كشف الإجابة'),'reveal',{},'primary');actions.append(revealEl);
      revealEl.disabled=p==='active';
    }
    if(p==='revealed')actions.append(control(t('Next turn','الدور التالي'),'next',{},'primary'));
    if(p==='active')actions.append(control(t('Pause timer','إيقاف المؤقت مؤقتاً'),'pause'));
    if(['paused','suspended'].includes(p))actions.append(control(t('Resume','استئناف'),'resume',{},'primary'));
    if(p==='exhausted')actions.append(control(t('Retry allocation','إعادة تخصيص الأسئلة'),'retry',{},'primary'));
    panel.append(actions);
    if(!['completed','cancelled'].includes(p)){
      const tools=node('details','',node('summary','',t('Exceptional controls','أدوات الحالات الاستثنائية')));
      const items=node('div','ar-actions');
      if(!['lobby','suspended'].includes(p))items.append(confirmControl(t('Suspend tournament','تعليق البطولة'),'suspend',t('Pause play for everyone in this tournament?','تعليق اللعب لجميع المشاركين؟')));
      if(['active','card','locked','paused','expired'].includes(p))items.append(confirmControl(t('Replace question','استبدال السؤال'),'skip',t('Keep this team’s turn and invalidate its current question?','إبقاء الدور لهذا الفريق وإلغاء السؤال الحالي؟')));
      if(m && !['lobby','match_ready','suspended'].includes(p)){
        items.append(confirmControl(t('Restart match','إعادة المباراة'),'restart',t('Restart this match and reset its score? Previously used questions stay consumed.','إعادة هذه المباراة وتصفير نقاطها؟ تبقى الأسئلة المستخدمة مسجّلة.')));
        items.append(actionButton(t('Adjust score','تعديل النقاط'),()=>dialog(t('Adjust score','تعديل النقاط'),(f,submit)=>{
          const sel=selectTeam(f,[team(m.a),team(m.b)].filter(Boolean));
          const delta=field(f,t('Signed points change','مقدار تغيير النقاط'),'number','',{step:'1',min:'-100',max:'100',required:''});
          const reason=field(f,t('Reason','السبب'),'text','',{required:'',maxlength:'250'});
          submit(t('Apply adjustment','تطبيق التعديل'),()=>command('adjust',{team:sel.value,delta:Number(delta.value),reason:reason.value},expected),'danger');
        })));
      }
      items.append(confirmControl(t('End tournament','إنهاء البطولة'),'cancel',t('End this session and stop further play?','إنهاء هذه الجلسة وإيقاف اللعب؟')));
      tools.append(items);panel.append(tools);
    }
    return panel;
  }
  function selectTeam(form,list) {
    const sel=node('select');
    for(const x of list){const o=node('option','',x.name);o.value=x.id;sel.append(o);}
    form.append(node('label','ar-field',t('Team','الفريق'),sel));return sel;
  }
  function editTeam(x) {
    const expected=state.version;
    dialog(x?t('Edit team','تعديل الفريق'):t('Add team','إضافة فريق'),(f,submit)=>{
      const name=field(f,t('Team name','اسم الفريق'),'text',x?.name||'',{required:'',maxlength:'60'});
      const color=field(f,t('Team color','لون الفريق'),'color',safeColor(x?.color));
      const icon=field(f,t('Team icon','رمز الفريق'),'text',x?.icon||'',{maxlength:'16'});
      submit(t('Save','حفظ'),()=>command(x?'rename':'add_team',{...(x?{team:x.id}:{}),name:name.value.trim(),color:color.value,icon:icon.value.trim()},expected));
    });
  }
  function teamTools() {
    const panel=heading(t('Team access','دخول الفرق')), accordion=node('details','',node('summary','',t('Manage teams','إدارة الفرق')+' ('+number(state.teams?.length)+')'));
    const list=node('div','ar-stack');
    if(state.phase==='lobby')list.append(actionButton(t('Add team','إضافة فريق'),()=>editTeam(null)));
    for(const x of state.teams||[]){
      const block=node('div','ar-match',node('strong','',x.name),node('small','',
        textFor(labels,x.status)+' · '+(x.online?t('Recently connected','متصل مؤخراً'):t('No recent connection','لا اتصال حديث'))));
      const actions=node('div','ar-actions');
      const key='trivia:invite:'+code+':'+x.id;
      let saved=inviteInMemory.get(key);
      if(!saved){try{saved=JSON.parse(cacheRead(sessionStorage,key));}catch{}}
      function showInvite(creds){share(x.name,gameURL('team/'+code+'/'+x.id+'/'+creds.secret),creds.pin);}
      const expected=state.version;
      if(saved?.secret) actions.append(actionButton(t('Show invitation','عرض الدعوة'),()=>showInvite(saved)));
      if(!['completed','cancelled'].includes(state.phase)){
        const rotate=async ()=>{
          const v=await command('credentials',{team:x.id},expected);
          if(!v?.secret)throw Error(t('No invitation returned','لم تصل بيانات الدعوة'));
          const creds={secret:v.secret,pin:v.pin};inviteInMemory.set(key,creds);cacheWrite(sessionStorage,key,JSON.stringify(creds));
          // Allow the confirmation dialog to close before opening its success dialog.
          setTimeout(()=>{if(alive())showInvite(creds);},0);
        };
        const issue=t('Issue new invitation','إصدار دعوة جديدة');
        actions.append(actionButton(issue,()=>confirmAction(issue,t('Replace the joining link and PIN and disconnect this team’s devices? Share the new invitation privately.','استبدال رابط الانضمام ورمز الفريق وفصل أجهزته؟ شارك الدعوة الجديدة على نحو خاص.'),rotate)));
        const available=(state.team_devices||[]).filter(d=>d.team_id===x.id && !d.answering);
        if(available.length)actions.append(actionButton(t('Transfer answering access','نقل صلاحية الإجابة'),()=>dialog(t('Transfer answering access','نقل صلاحية الإجابة'),(f,submit)=>{
          f.append(node('p','',t('Select the device ID shown on the replacement device. The current answering device will switch to read-only access.','اختر المعرّف الظاهر على الجهاز البديل. سيتحول جهاز الإجابة الحالي إلى وضع المشاهدة.')));
          const sel=node('select');
          for(const d of available){const o=node('option','',d.id.slice(-8)+' · '+new Date(d.last_seen).toLocaleTimeString(ar?'ar-AE':'en-AE'));o.value=d.id;sel.append(o);}
          f.append(node('label','ar-field',t('Replacement device','الجهاز البديل'),sel));
          submit(t('Confirm transfer','تأكيد النقل'),()=>command('transfer',{team:x.id,device:sel.value},expected),'danger');
        })));
        actions.append(confirmControl(t('Release answering device','إلغاء تصريح جهاز الإجابة'),'revoke',t('Release this team’s answering device so its replacement can join?','إلغاء تصريح جهاز هذا الفريق للسماح لجهاز بديل بالانضمام؟'),{team:x.id}));
        actions.append(actionButton(t('Edit team','تعديل الفريق'),()=>editTeam(x)));
        if(state.phase==='lobby')actions.append(confirmControl(t('Remove team','حذف الفريق'),'remove_team',t('Remove this team from the lobby?','حذف هذا الفريق من الردهة؟'),{team:x.id}));
        else if(state.phase!=='suspended' && !['disqualified','eliminated','withdrawn'].includes(x.status)){
          actions.append(actionButton(t('Disqualify','استبعاد'),()=>dialog(t('Disqualify team','استبعاد فريق')+' · '+x.name,(f,submit)=>{
            const reason=field(f,t('Reason for disqualification','سبب الاستبعاد'),'text','',{required:'',maxlength:'250'});
            submit(t('Confirm disqualification','تأكيد الاستبعاد'),()=>command('disqualify',{team:x.id,reason:reason.value},expected),'danger');
          }),'danger'));
        }
      }
      block.append(actions);list.append(block);
    }
    accordion.append(list);panel.append(accordion);return panel;
  }
  function logs() {
    const box=node('details','ar-panel',node('summary','',t('Session activity','سجل الجلسة')));
    const ul=node('ol','ar-list');
    for(const entry of (state.logs||[]).slice(0,100)){
      const date=new Date(entry.created_at);
      const time=Number.isNaN(+date)?'':date.toLocaleTimeString(ar?'ar-AE':'en-AE',{hour:'2-digit',minute:'2-digit'});
      ul.append(node('li','',textFor(events,entry.action)+' · '+time+(entry.detail?.reason?' · '+entry.detail.reason:'')));
    }
    box.append(ul);return box;
  }
  async function results() {
    const report=await rpc('trivia_history',{p_code:code});
    if(report?.error)throw Error(report.error);
    if(!alive())return;
    const turns=(report.turns||[]).filter(x=>!x.invalid && x.revealed_at);
    const table=node('table','ar-table'),h=node('tr');
    const headings=[t('Team','الفريق'),t('Correct','صحيح'),t('Incorrect','خطأ'),t('Timeout','انتهى الوقت'),t('Accuracy','الدقة'),t('Average response','متوسط زمن الإجابة')];
    for(const label of headings)h.append(node('th','',label));
    table.append(node('thead','',h));const body=node('tbody');
    for(const x of state.teams){
      const own=turns.filter(y=>y.team_id===x.id),good=own.filter(y=>y.is_correct).length,
        missed=own.filter(y=>y.timeout).length,timed=own.filter(y=>typeof y.response_seconds==='number');
      const row=node('tr'),average=timed.length?timed.reduce((a,y)=>a+y.response_seconds,0)/timed.length:null;
      for(const v of [x.name,number(good),number(own.length-good-missed),number(missed),own.length?number(Math.round(100*good/own.length))+'%':'—',average===null?'—':number(Math.round(average*10)/10)+' '+t('s','ث')])row.append(node('td','',v));
      body.append(row);
    }
    table.append(body);
    dialog(t('Tournament report','تقرير البطولة'),form=>{
      const holder=node('div','ar-table-wrap',table);form.append(holder);
      const categories=new Map();
      for(const x of turns){const name=categoryName(x.category);if(!categories.has(name))categories.set(name,{total:0,correct:0});const v=categories.get(name);v.total++;if(x.is_correct)v.correct++;}
      const breakdown=node('ul','ar-list');
      for(const [name,v] of categories)breakdown.append(node('li','',name+' · '+number(v.correct)+' / '+number(v.total)+' · '+number(Math.round(100*v.correct/v.total))+'%'));
      const sudden=turns.filter(x=>x.sudden);
      const stats=node('div','ar-stack',node('h3','',t('Category accuracy','دقة الإجابات حسب الفئة')),breakdown,
        node('p','',t('Sudden-death answers correct','الإجابات الصحيحة في كسر التعادل')+' · '+number(sudden.filter(x=>x.is_correct).length)+' / '+number(sudden.length)));
      const durations=node('ul','ar-list');
      const times=(report.matches||[]).filter(m=>m.started_at);
      const elapsed=(start,end)=>number(Math.max(0,Math.round((end-start)/1000)))+' '+t('s','ث');
      if(times.length){
        for(const m of times){if(m.finished_at)durations.append(node('li','',teamName(m.a)+' × '+teamName(m.b)+' · '+elapsed(Date.parse(m.started_at),Date.parse(m.finished_at))));}
        const ended=times.filter(m=>m.finished_at).map(m=>Date.parse(m.finished_at));
        if(report.phase==='completed' && ended.length)stats.append(node('p','',t('Tournament playing time','زمن لعب البطولة')+' · '+elapsed(Math.min(...times.map(m=>Date.parse(m.started_at))),Math.max(...ended))));
      }
      if(durations.children.length)stats.append(node('h3','',t('Match durations','مدة المباريات')),durations);
      form.append(stats);
      if(report.standings?.length){
        const ranking=node('ol','ar-list');
        for(const r of report.standings)ranking.append(node('li','',t('Place','المركز')+' '+(r.place==null?'—':number(r.place))+' · '+(r.name||teamName(r.team_id||r.team||r.id))));
        form.append(node('h3','',t('Standings','الترتيب')),ranking);
      }
      const buttons=node('div','ar-tools');
      buttons.append(actionButton(t('Export JSON','تصدير JSON'),()=>download('trivia-'+code+'.json',JSON.stringify(report,null,2),'application/json')));
      buttons.append(actionButton(t('Export answers CSV','تصدير الإجابات CSV'),()=>{
        const rows=[['match','team','turn','category','question','answer','correct','points','timeout','sudden_death','response_seconds','invalidated','revealed_at']];
        for(const x of report.turns||[])rows.push([x.match_id,teamName(x.team_id),x.turn_no,x.category,localized(x.question)||x.question?.text,x.answer,x.is_correct,x.points,x.timeout,x.sudden,x.response_seconds,x.invalid,x.revealed_at]);
        download('trivia-'+code+'-answers.csv',csv(rows),'text/csv;charset=utf-8');
      }));
      buttons.append(actionButton(t('Export results CSV','تصدير النتائج CSV'),()=>{
        const rows=[['round','team_a','score_a','team_b','score_b','winner','status']];
        for(const x of state.matches)rows.push([x.round_no,teamName(x.a),x.score_a,teamName(x.b),x.score_b,x.winner?teamName(x.winner):'',x.status]);
        download('trivia-'+code+'-matches.csv',csv(rows),'text/csv;charset=utf-8');
      }));
      buttons.append(actionButton(t('Print summary','طباعة الملخص'),()=>printPage('summary',node('div','ar-print-report',node('h1','',state.name),node('h2','',t('Tournament report','تقرير البطولة')),holder.cloneNode(true),stats.cloneNode(true)))));
      if(state.phase==='completed' && state.champion)buttons.append(actionButton(t('Winner certificate','شهادة الفائز'),()=>printPage('certificate')));
      form.append(buttons);
    });
  }
  function printPage(kind,reportNode) {
    frame.querySelector('.ar-print-report')?.remove();if(reportNode)frame.append(reportNode);
    frame.dataset.print=kind;
    const bracket=frame.querySelector('.ar-bracket'),wasOpen=bracket?.open;
    if(bracket)bracket.open=true;
    const modal=currentDialog;modal?.close();
    window.addEventListener('afterprint',()=>{
      delete frame.dataset.print;reportNode?.remove();
      if(bracket)bracket.open=Boolean(wasOpen);
    },{once:true});
    window.print();
  }
  function preferences() {
    dialog(t('Display and sound','الشاشة والصوت'),form=>{
      const status=node('small');
      const effects=actionButton('',async()=>{
        if(!audio.effects && !await audio.unlock()) {status.textContent=t('Audio is unavailable on this device.','يتعذّر تشغيل الصوت على هذا الجهاز.');return;}
        audio.enable(!audio.effects);audio.play('correct');update();
      });
      const music=actionButton('',async()=>{
        if(!audio.music && !await audio.unlock()){status.textContent=t('Audio is unavailable on this device.','يتعذّر تشغيل الصوت على هذا الجهاز.');return;}
        audio.background(!audio.music);update();
      });
      function update(){
        effects.textContent=state.settings?.sound===false?t('Effects disabled for this game','المؤثرات معطلة لهذه اللعبة'):audio.effects?t('Mute effects','كتم المؤثرات'):t('Enable sound effects','تشغيل المؤثرات');
        effects.setAttribute('aria-pressed',String(audio.effects));
        music.textContent=audio.music?t('Stop background music','إيقاف موسيقى الخلفية'):t('Play background music','تشغيل موسيقى الخلفية');
        music.setAttribute('aria-pressed',String(audio.music));
      }
      form.append(effects,music);
      if(state.settings?.sound===false)effects.disabled=true;
      const volume=field(form,t('Volume','مستوى الصوت'),'range',String(audio.volume),{min:'0',max:'1',step:'0.05'});
      volume.oninput=()=>{audio.volume=volume.value;};form.append(status);update();
    });
  }
  function render() {
    if(!alive()||!state)return;
    // Keep details open and keyboard position stable across database revisions.
    const prior=new Map([...content.querySelectorAll('details')].map(x=>[x.firstElementChild?.textContent,x.open]));
    const focused=content.contains(document.activeElement)?document.activeElement.textContent:null;
    const p=phase();frame.dataset.phase=p;
    const message=phaseName(p)+(state.active_team?' · '+teamName(state.active_team):'');if(announce.textContent!==message)announce.textContent=message;
    clockEl=lockEl=revealEl=null;
    const top=node('header','ar-top'),tools=node('div','ar-tools');
    const caption=mode==='manager'?t('Manager control room','لوحة تحكم المدير'):
      mode==='team'?teamName(teamId):t('Spectator screen','شاشة الجمهور');
    netEl=node('span','ar-connection');netEl.setAttribute('role','status');
    top.append(node('div','',node('p','ar-kicker',caption+' · '+code),node('h1','',state.name)),tools);
    tools.append(netEl,actionButton(t('Display & sound','الشاشة والصوت'),preferences));
    if(frame.requestFullscreen||frame.webkitRequestFullscreen){
      tools.append(actionButton(t('Fullscreen','ملء الشاشة'),async()=>{
        if(document.fullscreenElement)await document.exitFullscreen();
        else if(document.webkitFullscreenElement)await document.webkitExitFullscreen();
        else await (frame.requestFullscreen?frame.requestFullscreen():frame.webkitRequestFullscreen());
      }));
    }
    if(mode==='team' && state.device_id)tools.append(badge(t('Device ID','معرّف الجهاز')+' · '+state.device_id.slice(-8)));
    if(mode==='manager'&&state.settings?.spectators!==false){
      const url=gameURL('watch/'+code);
      tools.append(actionButton(t('Spectator QR','رمز الجمهور'),()=>share(t('Spectator access','دخول الجمهور'),url)),
        actionButton(t('Open spectator view','فتح شاشة الجمهور'),()=>{window.open(url,'_blank','noopener,noreferrer');}));
    }
    const m=(state.matches||[]).find(x=>x.id===state.match_id);
    const primary=gameView(m),layout=node('div','ar-layout',primary);
    if(mode==='manager' && state.manager){
      const rail=node('aside','ar-rail',managerControls(m),teamTools(),heading(t('Results','النتائج'),
        actionButton(t('View report & export','عرض التقرير وتصديره'),results)),logs());
      layout.append(rail);
    }
    primary.append(bracket());
    if(p==='completed' && state.champion){
      const standings=node('ol','ar-list');
      for(const r of state.standings||[])standings.append(node('li','',r.name+' · '+(r.place!=null?t('Place','المركز')+' '+number(r.place):textFor(labels,r.status))));
      primary.append(heading(t('Final standings','الترتيب النهائي'),standings));
      primary.append(node('div','ar-cert',node('p','',state.name),node('h2','',t('Certificate of Achievement','شهادة إنجاز')),
        node('strong','',teamName(state.champion)),node('p','',t('Knockout Tournament Champion','بطل منافسات خروج المغلوب')),node('p','',code)));
    }
    content.replaceChildren(top,layout);
    for(const d of content.querySelectorAll('details')){const k=d.firstElementChild?.textContent;if(prior.has(k))d.open=prior.get(k);}
    if(focused && !currentDialog){
      const b=[...content.querySelectorAll('button')].find(x=>x.textContent===focused && !x.disabled);b?.focus({preventScroll:true});
    }
    connection();
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refresh();schedule();}},{signal:scope.signal});
  window.addEventListener('online',()=>{void refresh();schedule();},{signal:scope.signal});
  window.addEventListener('offline',()=>{failed=true;connection();},{signal:scope.signal});
  if(mode==='team' && !device){joinForm();}
  else{
    content.append(heading(t('Connecting to the tournament…','جارٍ الاتصال بالبطولة…')));
    await refresh();if(alive())schedule();
  }
  if(alive())ticker=setInterval(tick,250);
  return close;
}
