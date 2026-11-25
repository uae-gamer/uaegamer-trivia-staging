import {fields,parseCSV,encodeCSV,normalizeQuestion} from './bank-format.mjs';
import {uploadQuestionMedia,resolveQuestionMedia} from './question-media.mjs';
const sheet=new URL('./admin.css',import.meta.url);
const css=document.createElement('link');css.rel='stylesheet';css.href=sheet;document.head.append(css);
function el(tag,txt,cls){const n=document.createElement(tag);if(txt!=null)n.textContent=txt;if(cls)n.className=cls;return n;}
function group(...items){const n=el('div',null,'bank-row');n.append(...items);return n;}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=el('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
const defaults={siteName:'UAEGamer Trivia',defaultLanguage:'en',theme:'dark',primaryColor:'#7454ef',registrationOpen:true,requireApproval:false,maintenance:false,privateBanks:true,allowSpectators:true,sound:true,animations:true,minTeams:2,maxTeams:32,minDuration:5,maxDuration:300,defaultDuration:60,minQuestions:1,maxQuestions:20,defaultQuestions:5,sessionHours:168,retentionDays:90,maxPrivateBanks:5,maxPrivateQuestions:1000,maxMediaMB:25,maxImportRows:200};
const settings=[
 ['siteName','Website name','اسم الموقع'],['description','English description','الوصف الإنجليزي'],['descriptionAr','Arabic description','الوصف العربي'],['homeTitleEn','Homepage title (EN)','عنوان الرئيسية بالإنجليزية'],['homeTitleAr','Homepage title (AR)','عنوان الرئيسية بالعربية'],['homeTextEn','Homepage introduction (EN)','مقدمة الرئيسية بالإنجليزية'],['homeTextAr','Homepage introduction (AR)','مقدمة الرئيسية بالعربية'],['logo','Logo URL','رابط الشعار'],['favicon','Favicon URL','رابط أيقونة الموقع'],['defaultLanguage','Default language','اللغة الافتراضية',['en','ar']],['theme','Theme','المظهر',['system','dark','light']],['primaryColor','Primary color','اللون الرئيسي','color'],['fontFamily','Font family','الخط'],['contactEmail','Contact email','بريد التواصل'],['socialLinks','Social links','روابط التواصل'],['registrationOpen','Allow registration','فتح التسجيل','checkbox'],['requireApproval','Approve new managers','الموافقة على المديرين الجدد','checkbox'],['maintenance','Maintenance mode','وضع الصيانة','checkbox'],['privateBanks','Private banks enabled','تمكين البنوك الخاصة','checkbox'],['allowSpectators','Allow spectators','السماح بالمشاهدة','checkbox'],['sound','Default sound effects','المؤثرات الصوتية الافتراضية','checkbox'],['animations','Animations','الحركة','checkbox'],['minTeams','Minimum teams','أقل عدد للفرق','number'],['maxTeams','Maximum teams','أكبر عدد للفرق','number'],['defaultDuration','Default seconds','مدة السؤال الافتراضية','number'],['minDuration','Minimum seconds','أقل مدة بالثواني','number'],['maxDuration','Maximum seconds','أطول مدة بالثواني','number'],['defaultQuestions','Default questions per team','عدد الأسئلة الافتراضي لكل فريق','number'],['minQuestions','Minimum questions','الحد الأدنى للأسئلة','number'],['maxQuestions','Maximum questions','الحد الأقصى للأسئلة','number'],['sessionHours','Session lifetime (hours)','صلاحية الجلسة بالساعات','number'],['retentionDays','Retention (days)','مدة الاحتفاظ بالأيام','number'],['maxPrivateBanks','Private banks per user','البنوك الخاصة لكل مستخدم','number'],['maxPrivateQuestions','Private questions per user','الأسئلة الخاصة لكل مستخدم','number'],['maxMediaMB','Media per uploader (MiB)','حصة الوسائط لكل مستخدم','number'],['maxImportRows','Maximum import rows','أقصى عدد للاستيراد','number'],['termsEn','Terms (EN)','الشروط بالإنجليزية','textarea'],['termsAr','Terms (AR)','الشروط بالعربية','textarea'],['privacyEn','Privacy (EN)','الخصوصية بالإنجليزية','textarea'],['privacyAr','Privacy (AR)','الخصوصية بالعربية','textarea']
];
export async function mountAdmin(ctx,route){
 const {root,t}=ctx;
 const rpc=(action,data={})=>ctx.rpc('trivia_manage',{p_action:action,p_data:data});
 const profile=await ctx.rpc('trivia_profile',{}),admin=profile?.role==='admin'&&profile?.status==='active';
 if(profile?.status!=='active'||(route==='admin'&&!admin)){root.textContent=t('Administrator or active manager access required.','يلزم حساب مدير نشط أو مسؤول.');return;}
 const wrap=el('section',null,'bank-workspace');root.replaceChildren(wrap);
 const isAdmin=route==='admin';wrap.append(el('h1',isAdmin?t('Administration','إدارة المنصة'):t('Question banks','بنوك الأسئلة')));
 const tabs=el('nav',null,'bank-tabs'),notice=el('div',null,'bank-notice'),body=el('div');notice.setAttribute('role','status');wrap.append(tabs,notice,body);
 let bank,bankList=[],cats=[],section=isAdmin?'summary':'bank',search='',status='',offset=0,category='',filterUser=null,gen=0,checked=new Map();
 const lang=(o,en='en',ar='ar')=>ctx.lang==='ar'?o[ar]||o[en]:o[en]||o[ar];

 function msg(s,bad=false){const errors={BANK_DENIED:['Bank access denied.','لا تملك صلاحية الوصول إلى هذا البنك.'],ADMIN_REQUIRED:['Administrator access required.','يلزم حساب مسؤول.'],STALE_OR_DENIED:['This record changed. Refresh and review the current revision.','تغيّر هذا السجل. حدّث الصفحة وراجع الإصدار الحالي.'],BAD_OPTIONS:['Check all option IDs, translations and the correct answer.','تحقق من معرفات الخيارات وترجماتها والخيار الصحيح.'],YES_NO_LABELS:['Use Yes and No with نعم and لا.','استخدم نعم ولا مع Yes وNo.'],BAD_QUESTION:['Check required fields, question type, difficulty and status.','تحقق من الحقول المطلوبة ونوع السؤال وصعوبته وحالته.'],VERIFICATION_REQUIRED:['Verify the source before publishing.','تحقق من المرجع قبل النشر.'],DUPLICATE:['This category already contains the same English question.','تتضمن هذه الفئة السؤال الإنجليزي نفسه.'],BANK_LIMIT:['Private bank limit reached.','بلغت الحد الأقصى للبنوك الخاصة.'],QUESTION_LIMIT:['Private question limit reached.','بلغت الحد الأقصى للأسئلة الخاصة.'],SELF_ROLE_CHANGE_DENIED:['Another administrator must change your access.','يجب أن يغيّر مسؤول آخر صلاحياتك.'],TEAM_RANGE:['Check team count limits (2–32).','تحقق من حدود عدد الفرق (٢–٣٢).'],INVALID_LIMIT:['Check import size, retention and session lifetime.','تحقق من حد الاستيراد ومدة الاحتفاظ وصلاحية الجلسة.'],DURATION_RANGE:['Check minimum, default and maximum duration.','تحقق من الحد الأدنى والافتراضي والأقصى للوقت.'],QUESTION_RANGE:['Check minimum, default and maximum questions.','تحقق من الحد الأدنى والافتراضي والأقصى للأسئلة.']};
 notice.textContent=bad&&errors[s]?t(...errors[s]):s;notice.classList.toggle('bank-error',bad);}
 function button(label,act,style=''){const b=el('button',label,'bank-button '+style);b.type='button';b.onclick=async()=>{b.disabled=true;try{await act()}catch(e){msg(e.message||String(e),true)}finally{b.disabled=false}};return b;}
 function field(label,type,value){
 const box=el('label',null,'bank-field');const title=el('span',label);let i;
 if(Array.isArray(type)){i=el('select');for(const v of type){const [key,text]=Array.isArray(v)?v:[v,v];const o=el('option',text);o.value=key;i.append(o);}}
 else if(type==='textarea')i=el('textarea');
 else{i=el('input');i.type=type||'text';}
 if(type==='checkbox')i.checked=!!value;else i.value=value??'';box.append(title,i);return {box,i,get:()=>type==='checkbox'?i.checked:type==='number'?Number(i.value):i.value};
 }
 function panel(title){const p=el('section',null,'bank-panel');p.append(el('h2',title));body.append(p);return p;}
 function paging(parent,rows){if(offset||rows.length===50)parent.append(group(...(offset?[button(t('Previous','السابق'),()=>{offset-=50;return render()})]:[]),el('span',String(offset+1)+'–'+String(offset+rows.length)),...(rows.length===50?[button(t('Next','التالي'),()=>{offset+=50;return render()})]:[])));}
 function buildTabs(){tabs.replaceChildren();const list=isAdmin?[['summary','Overview','نظرة عامة'],['bank','Banks & questions','البنوك والأسئلة'],['users','Users','المستخدمون'],['sessions','Sessions','الجلسات'],['settings','Settings','الإعدادات'],['logs','Activity','النشاط']]:[['bank','My banks','بنوكي']];for(const [key,en,ar] of list){const b=button(t(en,ar),()=>change(key));b.setAttribute('aria-pressed',String(section===key));tabs.append(b);}}
 function change(key){section=key;offset=0;status='';search='';filterUser=null;checked.clear();return render();}
 function searchBar(parent,filters=[]){const s=field(t('Search','بحث'),'search',search);const st=field(t('Status','الحالة'),[['',t('All','الكل')],...filters],status);
 const go=()=>{search=s.get();status=st.get();offset=0;return render()};const b=button(t('Apply filter','تطبيق التصفية'),go);s.i.onkeydown=e=>{if(e.key==='Enter')b.click()};parent.append(group(s.box,...(filters.length?[st.box]:[]),b));}
 const words={active:t('Active','نشط'),pending:t('Pending','قيد الموافقة'),suspended:t('Suspended','معلّق'),admin:t('Administrator','مسؤول'),manager:t('Manager','مدير'),draft:t('Draft','مسودة'),published:t('Published','منشور'),archived:t('Archived','مؤرشف'),mcq:t('Multiple choice','اختيار من متعدد'),yesno:t('Yes / No','نعم / لا'),easy:t('Easy','سهل'),medium:t('Medium','متوسط'),hard:t('Hard','صعب'),verified:t('Verified','موثّق'),review:t('Pending verification','قيد التحقق')};
 const choices=xs=>xs.map(x=>[x,words[x]||x]);const confirm=t=>window.confirm(t);
 async function render(){
 const g=++gen;buildTabs();body.replaceChildren();msg('');
 if(section==='bank'){await banks(g);return;}
 const data=await rpc(section,{search,status,offset,id:filterUser});if(g!==gen)return;
 if(section==='summary'){
 const p=panel(t('Platform overview','نظرة عامة على المنصة')),cards=el('div',null,'bank-metrics');
 for(const [k,en,ar] of [['users','Registered users','المستخدمون'],['managers','Active managers','مديرون نشطون'],['sessions','Sessions','الجلسات'],['active','Active sessions','جلسات نشطة'],['completed','Completed','مكتملة'],['teams','Teams','الفرق'],['matches','Matches','المباريات'],['questions','Questions','الأسئلة'],['categories','Categories','الفئات'],['presented','Questions presented','أسئلة معروضة'],['pending','Pending approvals','طلبات الموافقة']]){
 const card=el('div');card.append(el('strong',String(data[k])),el('span',t(en,ar)));cards.append(card);}p.append(cards);
 if(data.pending)p.append(button(t('Review pending managers','مراجعة طلبات المديرين'),()=>{section='users';status='pending';return render()}));
 const activity=await rpc('logs');if(g!==gen)return;listLogs(p,activity.slice(0,8));return;
 }
 if(section==='settings'){
 const p=panel(t('Website configuration','تهيئة الموقع')),grid=el('div',null,'bank-grid'),get={};
 for(const [key,en,ar,type] of settings){const f=field(t(en,ar),type,data[key]??defaults[key]??'');grid.append(f.box);get[key]=f.get;}
 p.append(grid,button(t('Save configuration','حفظ الإعدادات'),async()=>{if(!confirm(t('Apply these settings to the platform?','تطبيق هذه الإعدادات على المنصة؟')))return;await rpc('settings_save',{record:Object.fromEntries(Object.entries(get).map(([k,f])=>[k,f()]))});msg(t('Settings saved.','تم حفظ الإعدادات.'));},'primary'));return;
 }
 const p=panel(({users:t('User accounts','حسابات المستخدمين'),sessions:t('Tournaments','البطولات'),logs:t('Activity log','سجل النشاط')})[section]);
 if(section==='logs')listLogs(p,data);else{
 searchBar(p,section==='users'?choices(['active','pending','suspended']):[['lobby',t('Lobby','الردهة')],['match_ready',t('Match ready','مباراة جاهزة')],['active',t('Question active','السؤال مفتوح')],['suspended',t('Suspended','معلّقة')],['completed',t('Completed','مكتملة')],['cancelled',t('Cancelled','ملغاة')]]);
 if(filterUser)p.append(button(t('Clear user filter','إلغاء تصفية المستخدم'),()=>{filterUser=null;return render()}));
 for(const x of data){const card=el('article',null,'bank-item');p.append(card);if(section==='users'){
 card.append(el('h3',x.name||x.email),el('p',x.email));const role=field(t('Role','الصلاحية'),choices(['manager','admin']),x.role),state=field(t('Status','الحالة'),choices(['active','pending','suspended']),x.status);
 card.append(group(role.box,state.box,button(t('Save access','حفظ الصلاحيات'),async()=>{if(confirm(t('Change this account’s access?','تغيير صلاحيات هذا الحساب؟'))){await rpc('user_save',{id:x.id,role:role.get(),status:state.get()});await render();}},'warn'),button(t('Sessions','الجلسات')+' ('+x.sessions+')',()=>{section='sessions';status='';offset=0;search='';filterUser=x.id;return render();}),button(t('Activity','النشاط'),()=>{section='logs';offset=0;filterUser=x.id;return render();})));
 }else{
 card.append(el('h3',x.name),el('p',x.code+' · '+x.phase),button(t('Open tournament controls','فتح إدارة البطولة'),()=>ctx.go('manager/'+x.code)));
 }}}
 paging(p,data);
 }
 function listLogs(parent,rows){for(const x of rows){const line=el('p',null,'bank-log');line.append(el('time',new Date(x.created_at).toLocaleString(ctx.lang)),el('strong',x.action),el('small',x.actor||t('System','النظام')));parent.append(line);}if(!rows.length)parent.append(el('p',t('No activity recorded.','لا يوجد نشاط مسجل.')));}
 async function banks(g){
 bankList=await rpc('banks');if(g!==gen)return;
 const p=panel(t('Bank workspace','مساحة البنك'));if(!bankList.some(b=>b.id===bank))bank=bankList[0]?.id;
 const sel=field(t('Selected bank','البنك المختار'),bankList.map(b=>[b.id,b.name+' · '+(b.owner_id?t('Private','خاص'):t('Public','عام'))]),bank);sel.i.onchange=()=>{bank=sel.get();offset=0;category='';checked.clear();render().catch(e=>msg(e.message,true))};
 p.append(group(...(bank?[sel.box]:[]),button(t('Create bank','إنشاء بنك'),()=>bankForm(null)),...(bank?[button(t('Edit bank','تعديل البنك'),()=>bankForm(bankList.find(b=>b.id===bank)))]:[])));
 if(!bank)return;
 cats=await rpc('categories',{bank_id:bank});if(g!==gen)return;
 const tools=group(button(t('Categories','الفئات'),categoryList),button(t('New question','سؤال جديد'),()=>questionForm(null)),button(t('Review duplicates','مراجعة التكرار'),duplicates),button(t('Import','استيراد'),importForm),button(t('Export CSV','تصدير CSV'),()=>exportBank('csv')),button(t('Export JSON','تصدير JSON'),()=>exportBank('json')));p.append(tools);
 const q=panel(t('Questions','الأسئلة'));searchBar(q,choices(['published','draft','archived']));const cat=field(t('Filter category','تصفية الفئة'),[['',t('All categories','جميع الفئات')],...cats.map(c=>[c.name,lang(c,'name','name_ar')])],category);cat.i.onchange=()=>{category=cat.get();offset=0;render().catch(e=>msg(e.message,true))};q.append(cat.box);
 const rows=await rpc('questions',{bank_id:bank,offset,search,status,category});if(g!==gen)return;
 const edits=field(t('Bulk change','تعديل جماعي'),[...choices(['draft','published','archived']),...choices(['easy','medium','hard'])],'draft');
 q.append(group(edits.box,button(t('Apply to selected','تطبيق على المحدد'),async()=>{
 if(!checked.size){msg(t('Select at least one question.','حدد سؤالاً واحداً على الأقل.'),true);return;}
 if(!confirm(t('Apply this change to all selected questions?','تطبيق هذا التعديل على جميع الأسئلة المحددة؟')))return;
 const value=edits.get();await rpc('bulk_update',{bank_id:bank,items:[...checked.values()].map(r=>({id:r.id,revision:r.revision})),field:['easy','medium','hard'].includes(value)?'difficulty':'status',value});checked.clear();await render();},'warn')));
 for(const row of rows){const r=row.record,card=el('article',null,'bank-item');const ch=field(t('Select','تحديد'),'checkbox',checked.has(row.id));ch.i.onchange=()=>{if(ch.get())checked.set(row.id,row);else checked.delete(row.id)};
 card.append(group(ch.box,el('strong',lang(r))),el('p',r.category+' · '+words[r.difficulty]+' · '+words[r.status]),group(button(t('Preview','معاينة'),()=>preview(row)),button(t('Edit','تعديل'),()=>questionForm(row)),button(t('Duplicate','نسخ'),()=>questionForm({...row,id:null,record:{...r,en:r.en+' (2)',ar:r.ar+' (٢)',status:'draft'}}))));q.append(card);}
 if(!rows.length)q.append(el('p',t('No matching questions.','لا توجد أسئلة مطابقة.')));paging(q,rows);
 }
 async function duplicates(){const p=formStart(t('Potential duplicates','أسئلة يحتمل تكرارها'));let page=0;
 const results=el('div');p.append(results);const load=async()=>{const rows=await rpc('duplicates',{bank_id:bank,offset:page});results.replaceChildren();if(!rows.length)results.append(el('p',t('No matching wording found.','لم يُعثر على صياغات متطابقة.')));
 for(const r of rows)results.append(group(el('strong',r.title),el('span',r.language.toUpperCase()+' · '+r.total+' · '+r.categories.join(' / ')),button(t('Find questions','البحث عن الأسئلة'),()=>{search=r.title;category='';offset=0;status='';return render()})));
 if(page)results.append(button(t('Previous','السابق'),()=>{page-=50;return load()}));if(rows.length===50)results.append(button(t('Next','التالي'),()=>{page+=50;return load()}));};await load();}
 function formStart(title){body.replaceChildren();msg('');const p=panel(title);p.append(button(t('Back to bank','العودة إلى البنك'),render));return p;}
 function bankForm(b){const p=formStart(b?t('Edit bank','تعديل البنك'):t('Create bank','إنشاء بنك'));
 const name=field(t('Bank name','اسم البنك'),'text',b?.name),pub=field(t('Public bank','بنك عام'),'checkbox',false),arch=field(t('Archive bank','أرشفة البنك'),'checkbox',b?.archived);p.append(name.box,...(!b&&admin?[pub.box]:[]),...(b?[arch.box]:[]));
 p.append(button(t('Save bank','حفظ البنك'),async()=>{if(b?.archived!==arch.get()&&b&&!confirm(t('Change bank availability?','تغيير إتاحة البنك؟')))return;const out=await rpc(b?'bank_update':'bank_create',{bank_id:b?.id,name:name.get(),public:pub.get(),archived:arch.get()});bank=out.id;await render();},'primary'));}
 function categoryList(){const p=formStart(t('Bank categories','فئات البنك'));p.append(button(t('New category','فئة جديدة'),()=>categoryForm(null)));for(const c of cats)p.append(group(el('span',c.icon+' '+lang(c,'name','name_ar')+' · '+c.question_count),button(t('Edit','تعديل'),()=>categoryForm(c))));}
 function categoryForm(c){const p=formStart(t('Category details','تفاصيل الفئة'));const input={},grid=el('div',null,'bank-grid');
 for(const [k,en,ar,typ,def] of [['name','English name','الاسم الإنجليزي'],['name_ar','Arabic name','الاسم العربي'],['description','English description','الوصف الإنجليزي'],['description_ar','Arabic description','الوصف العربي'],['icon','Icon','الرمز','text','✦'],['color','Color','اللون','color','#6543dc'],['position','Display order','ترتيب العرض','number',0],['enabled','Enabled','مفعّلة','checkbox',true],['archived','Archived','مؤرشفة','checkbox',false]]){
 const f=field(t(en,ar),typ,c?.[k]??def);grid.append(f.box);input[k]=f.get;}
 p.append(grid,button(t('Save category','حفظ الفئة'),async()=>{await rpc('category_save',{bank_id:bank,id:c?.id,record:Object.fromEntries(Object.entries(input).map(([k,get])=>[k,get()]))});await render()},'primary'));}
 async function preview(row){const p=formStart(t('Question preview','معاينة السؤال')),r=row.record;p.append(el('h3',r.en),el('h3',r.ar));for(const o of r.options)p.append(el('p',(o.id===r.correct?'✓ ':'')+o.en+' · '+o.ar));
 for(const k of ['image','audio'])if(r[k]){const url=await resolveQuestionMedia(ctx,r[k]);const n=el(k==='image'?'img':'audio');n.src=url;if(k==='audio')n.controls=true;else n.alt=t('Question image','صورة السؤال');p.append(n);}
 p.append(el('p',r.explanation_en||''),el('p',r.explanation_ar||''),el('p',t('Reference','المرجع')+' · '+(r.source||'—')));
 if(row.id){const s=await rpc('question_stats',{bank_id:bank,id:row.id});p.append(el('p',t('Presented','مرات العرض')+' '+s.uses+' · '+t('Correct','صحيح')+' '+s.correct+' · '+t('Incorrect','خطأ')+' '+s.incorrect+' · '+t('Timeouts','انتهاء الوقت')+' '+s.timeouts));}}
 function questionForm(row){const p=formStart(t('Question editor','محرر السؤال')),r=row?.record||{},input={},grid=el('div',null,'bank-grid');
 if(!cats.some(c=>!c.archived)){p.append(button(t('Create a category first','أنشئ فئة أولاً'),()=>categoryForm(null)));return;}
 const specs=[['category','Category','الفئة',cats.filter(c=>!c.archived).map(c=>[c.name,lang(c,'name','name_ar')]),cats.find(c=>!c.archived)?.name],['subcategory','Subcategory','الفئة الفرعية'],['type','Type','النوع',choices(['mcq','yesno']),'mcq'],['difficulty','Difficulty','الصعوبة',choices(['easy','medium','hard']),'easy'],['en','English question','السؤال بالإنجليزية','textarea'],['ar','Arabic question','السؤال بالعربية','textarea'],['explanation_en','English explanation','الشرح بالإنجليزية','textarea'],['explanation_ar','Arabic explanation','الشرح بالعربية','textarea'],['source','Reference or verification method','المرجع أو طريقة التحقق'],['verification','Verification','التحقق',choices(['review','verified']),'review'],['status','Publication status','حالة النشر',choices(['draft','published','archived']),'draft'],['time_limit','Seconds override (optional)','مدة بديلة بالثواني (اختياري)','text']];
 for(const [k,en,ar,typ,def] of specs){const f=field(t(en,ar),typ,r[k]??def);grid.append(f.box);input[k]=f;}
 p.append(grid);const options=el('div',null,'bank-options'),edits=[];p.append(el('h3',t('Answer options','خيارات الإجابة')),options);
 function rebuild(vals,correct){options.replaceChildren();edits.length=0;
 for(const o of vals){const en=field(t('English option','الخيار الإنجليزي'),'text',o.en),ar=field(t('Arabic option','الخيار العربي'),'text',o.ar),key=field(t('Correct','صحيح'),'radio','');key.i.name='bank-answer';key.i.checked=o.id===correct;
 edits.push({id:o.id,en,ar,key});options.append(group(key.box,en.box,ar.box));}}
 function vals(){return edits.map(o=>({id:o.id,en:o.en.get(),ar:o.ar.get()}));}
 function answer(){return edits.find(o=>o.key.i.checked)?.id||'';}
 const blank=()=>({id:crypto.randomUUID(),en:'',ar:''});
 rebuild(r.options||Array.from({length:4},blank),r.correct);input.type.i.onchange=()=>{if(input.type.get()==='yesno')rebuild([{id:'yes',en:'Yes',ar:'نعم'},{id:'no',en:'No',ar:'لا'}],answer());};
 p.append(group(button(t('Add option','إضافة خيار'),()=>{if(edits.length<6&&input.type.get()==='mcq')rebuild([...vals(),blank()],answer())}),button(t('Remove last option','حذف الخيار الأخير'),()=>{if(edits.length>2)rebuild(vals().slice(0,-1),answer())})));
 for(const [k,en,ar,accept] of [['image','Question image','صورة السؤال','.png,.jpg,.jpeg,.webp'],['audio','Question audio','صوت السؤال','.mp3,.ogg']]){const f=field(t(en,ar),'text',r[k]);input[k]=f;const file=field(t('Upload file','رفع ملف'),'file');file.i.accept=accept;p.append(group(f.box,file.box,button(t('Upload','رفع'),async()=>{f.i.value=await uploadQuestionMedia(ctx,bank,file.i.files[0]);msg(t('Uploaded. Save the question to attach it.','اكتمل الرفع. احفظ السؤال لإرفاق الملف.'));})));}
 p.append(button(t('Save question','حفظ السؤال'),async()=>{const record=normalizeQuestion({...Object.fromEntries(Object.entries(input).map(([k,f])=>[k,f.get()])),options:vals(),correct:answer()});await rpc('question_save',{bank_id:bank,id:row?.id,revision:row?.revision,record});await render()},'primary'));}
 async function exportBank(format){let all=[],start=0;while(true){const rows=await rpc('questions',{bank_id:bank,offset:start});all.push(...rows.map(x=>x.record));if(rows.length<50)break;start+=50;}download('trivia-bank.'+format,format==='csv'?encodeCSV(all):JSON.stringify(all,null,2),format==='csv'?'text/csv':'application/json');}
 function importForm(){const p=formStart(t('Import questions','استيراد الأسئلة')),file=field(t('CSV or JSON file','ملف CSV أو JSON'),'file');file.i.accept='.csv,.json';
 const example={category:cats.find(c=>!c.archived)?.name||'Mathematics',en:'What is 6 × 7?',ar:'كم يساوي ٦ × ٧؟',type:'mcq',difficulty:'easy',options:[{id:'a',en:'42',ar:'٤٢'},{id:'b',en:'48',ar:'٤٨'}],correct:'a',status:'draft',verification:'review',source:'6 × 7 = 42'};
 p.append(group(button(t('CSV template','نموذج CSV'),()=>download('trivia-template.csv',encodeCSV([example]),'text/csv')),button(t('JSON template','نموذج JSON'),()=>download('trivia-template.json',JSON.stringify([example],null,2),'application/json'))),file.box);
 const stage=el('div');p.append(button(t('Read file','قراءة الملف'),async()=>{const f=file.i.files[0];if(!f||f.size>3000000)throw Error(t('Select a file under 3 MB.','اختر ملفاً أقل من ٣ ميغابايت.'));const raw=await f.text();const rows=f.name.toLowerCase().endsWith('.csv')?parseCSV(raw):JSON.parse(raw.replace(/^\uFEFF/,''));if(!Array.isArray(rows)||!rows.length||rows.length>1000||!rows.every(o=>o&&typeof o==='object'&&!Array.isArray(o)))throw Error(t('Expected 1–1,000 question records.','يلزم من ١ إلى ١٠٠٠ سجل.'));mapping(rows);}),stage);
 function mapping(rows){stage.replaceChildren(el('h3',t('Map columns','ربط الأعمدة')));const keys=Object.keys(rows[0]),get={},grid=el('div',null,'bank-grid');for(const k of fields){const f=field(k,[['','—'],...keys],keys.includes(k)?k:'');grid.append(f.box);get[k]=f.get;}stage.append(grid);
 const catMap=el('div'),next=el('div');stage.append(button(t('Map categories','ربط الفئات'),()=>{catMap.replaceChildren();next.replaceChildren();
 const mapped=rows.map(row=>Object.fromEntries(fields.filter(k=>get[k]()).map(k=>[k,row[get[k]()]])));
 const vals=[...new Set(mapped.map(r=>String(r.category||'')))];const inputs=new Map();
 for(const val of vals){const f=field(val||t('Missing category','فئة مفقودة'),[['','—'],...cats.filter(c=>!c.archived).map(c=>[c.name,lang(c,'name','name_ar')])],cats.find(c=>c.name.toLowerCase()===val.toLowerCase())?.name||'');catMap.append(f.box);inputs.set(val,f);}
 catMap.append(button(t('Validate and preview','تحقق ومعاينة'),async()=>{next.replaceChildren();const seen=new Set(),ok=[],issues=[],prior=new Set();let at=0;while(true){const page=await rpc('questions',{bank_id:bank,offset:at});for(const q of page)prior.add(q.record.category+'|'+q.record.en.trim().toLowerCase().replace(/\s+/g,' '));if(page.length<50)break;at+=50;}
 mapped.forEach((r,i)=>{try{const q=normalizeQuestion({...r,category:inputs.get(String(r.category||'')).get()});const sig=q.category+'|'+q.en.toLowerCase().replace(/\s+/g,' ');if(seen.has(sig)||prior.has(sig))throw Error(t('Duplicate','مكرر'));if(q.status==='published'&&(q.verification!=='verified'||!q.source))throw Error(t('Verification required','التحقق مطلوب'));seen.add(sig);ok.push(q);}catch(e){issues.push((i+1)+' · '+e.message);}});
 next.append(el('h3',t('Import preview','معاينة الاستيراد')),el('p',t('Ready','جاهز')+' '+ok.length+' · '+t('Skipped','تم تجاوزها')+' '+issues.length));for(const q of ok.slice(0,10))next.append(el('p',q.category+' · '+lang(q)));for(const s of issues.slice(0,25))next.append(el('p',s));if(issues.length)next.append(button(t('Download issues','تنزيل المشكلات'),()=>download('import-issues.txt',issues.join('\n'),'text/plain')));
 if(ok.length)next.append(button(t('Confirm import','تأكيد الاستيراد'),async()=>{if(!confirm(t('Import the validated questions?','استيراد الأسئلة التي اجتازت التحقق؟')))return;const cfg=await ctx.rpc('trivia_site',{});const size=Math.max(1,Math.min(100,+cfg.maxImportRows||200));const results=[];for(let i=0;i<ok.length;i+=size){const part=await rpc('import',{bank_id:bank,rows:ok.slice(i,i+size)});results.push(...part.map((x,j)=>({...x,row:i+j+1,question:ok[i+j].en})));}next.replaceChildren(el('h3',t('Import summary','ملخص الاستيراد')),el('p',t('Accepted','مقبول')+' '+results.filter(x=>x.status==='accepted').length+' · '+t('Duplicates','مكرر')+' '+results.filter(x=>x.status==='duplicate').length+' · '+t('Rejected','مرفوض')+' '+results.filter(x=>x.status==='rejected').length),button(t('Download results','تنزيل النتائج'),()=>download('import-results.json',JSON.stringify({results,skipped:issues},null,2),'application/json')),button(t('Return to bank','العودة إلى البنك'),render));},'primary'));
 }));}),catMap,next);}
 }
 await render();
}
