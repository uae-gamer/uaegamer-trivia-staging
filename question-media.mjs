const urls=new Map();
export async function resolveQuestionMedia(ctx,value,access={}){
  if(!value)return '';
  if(/^https:\/\//i.test(value))return value;
  if(!value.startsWith('trivia-media:'))return '';
  const key=value+':'+(ctx.user?.id??'')+':'+(access.p_code??'');
  const prev=urls.get(key);
  if(prev?.until>Date.now())return prev.url;
  const {data,error}=await ctx.sdk.functions.invoke('trivia-media',{body:{path:value.slice(13),access}});
  if(error||!data?.url)throw Error('Media unavailable / الوسائط غير متوفرة');
  urls.set(key,{url:data.url,until:Date.now()+50000});return data.url;
}
export async function uploadQuestionMedia(ctx,bank,file){
  if(!file || file.size>5242880)throw Error('Maximum file size 5 MiB / الحد ٥ ميبيبايت');
  let payload=file;
  if(['image/jpeg','image/png','image/webp'].includes(file.type)&&typeof createImageBitmap==='function'){
    const bitmap=await createImageBitmap(file);
    try{
      if(bitmap.width*bitmap.height>36000000)throw Error('Image dimensions too large / أبعاد الصورة كبيرة جداً');
      const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const draw=canvas.getContext('2d');
      if(draw){
        draw.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const compressed=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.86));
        if(compressed&&(compressed.size<file.size||scale<1))payload=compressed;
      }
    }finally{bitmap.close();}
  }
  const {data,error}=await ctx.sdk.functions.invoke('trivia-media',{body:payload,headers:{'x-trivia-bank':bank,'content-type':payload.type||'application/octet-stream'}});
  if(error || !data?.ref)throw Error('Upload failed. Check file format, size and quota. / تعذّر الرفع، تحقق من النوع والحجم والحصة.');
  return data.ref;
}
