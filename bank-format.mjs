// Quoted fields can span several lines. Header order is immaterial.
export const fields = ['category','en','ar','type','difficulty','options','correct','status','source','explanation_en','explanation_ar','image','audio','time_limit','subcategory','verification'];
export function parseCSV(input) {
  const rows=[], row=[];
  let field='', quoted=false, closed=false;
  input=input.replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quoted){
      if(c==='"' && input[i+1]==='"'){field+='"'; i++;}
      else if(c==='"'){quoted=false;closed=true;}
      else field+=c;
    }else if(c===',' || c==='\n' || c==='\r'){
      row.push(field);field='';closed=false;
      if(c!==','){if(c==='\r' && input[i+1]==='\n')i++; if(row.some(v=>v!==''))rows.push(row.splice(0));else row.length=0;}
    }else if(c==='"' && !field && !closed){quoted=true;}
    else if(c==='"' || closed)throw Error('Invalid CSV quoting / اقتباس غير صالح');
    else field+=c;
  }
  if(quoted)throw Error('Unclosed quoted field / اقتباس غير مغلق');
  row.push(field); if(row.some(v=>v!==''))rows.push(row);
  if(!rows.length)throw Error('Empty CSV / ملف فارغ');
  const headers=rows.shift().map(x=>x.trim()); 
  if(new Set(headers).size!==headers.length || headers.includes(''))throw Error('Invalid headers / عناوين أعمدة غير صالحة');
  return rows.map((r,i)=>{
    if(r.length!==headers.length)throw Error('Column count / عدد الأعمدة: '+(i+2));
    return Object.fromEntries(headers.map((k,j)=>[k,r[j]]));
  });
}
export function encodeCSV(records){
  const esc=v=>'"'+String(typeof v==='object'&&v!==null?JSON.stringify(v):v??'').replace(/"/g,'""')+'"';
  // Guard spreadsheet formula evaluation while keeping JSON export lossless.
  const cell=v=>esc(typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v);
  return '\uFEFF'+[fields.map(esc).join(','),...records.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\r\n');
}
export function normalizeQuestion(record){
  let r={...record};
  for(const k of fields)if(typeof r[k]==='string')r[k]=r[k].trim();
  if(typeof r.options==='string'){try{r.options=JSON.parse(r.options)}catch{throw Error('Options JSON / صيغة الخيارات');}}
  for(const k of ['category','en','ar'])if(!r[k]||typeof r[k]!=='string')throw Error('Missing / مفقود: '+k);
  if(!['mcq','yesno'].includes(r.type)||!['easy','medium','hard'].includes(r.difficulty))throw Error('Type or difficulty / النوع أو الصعوبة');
  if(!Array.isArray(r.options)||r.options.length<2||r.options.length>6||(r.type==='yesno'&&r.options.length!==2))throw Error('Option count / عدد الخيارات');
  if(r.options.some(o=>!o||typeof o!=='object'||!['id','en','ar'].every(k=>typeof o[k]==='string'&&o[k].trim())))throw Error('Option fields / حقول الخيارات');
  for(const k of ['id','en','ar'])if(new Set(r.options.map(o=>o[k].trim().toLowerCase())).size!==r.options.length)throw Error('Duplicate option / خيار مكرر');
  if(!r.options.some(o=>o.id===r.correct))throw Error('Correct option / الإجابة الصحيحة');
  r.status=r.status||'draft';
  if(!['draft','published','archived'].includes(r.status))throw Error('Status / الحالة');
  if(r.time_limit && (!Number.isInteger(+r.time_limit)||+r.time_limit<1||+r.time_limit>600))throw Error('Time limit / المدة');
  return r;
}
