const json=(x,s=200,h={})=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8",...h}});
const enc=new TextEncoder(), dec=new TextDecoder();

function b64(a){let s="";for(const x of a)s+=String.fromCharCode(x);return btoa(s).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
function unb64(s){s=s.replaceAll("-","+").replaceAll("_","/");while(s.length%4)s+="=";return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function hash(s){return b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s))))}
async function sig(p,secret){const k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64(new Uint8Array(await crypto.subtle.sign("HMAC",k,enc.encode(p))))}
async function token(data,secret){const p=b64(enc.encode(JSON.stringify(data)));return p+"."+await sig(p,secret)}
async function verify(t,secret){try{const [p,s]=t.split(".");if(s!==await sig(p,secret))return null;const d=JSON.parse(dec.decode(unb64(p)));return d.exp>Date.now()?d:null}catch{return null}}
const cookie=(n,v,max=2592000)=>`${n}=${v}; Max-Age=${max}; Path=/; HttpOnly; Secure; SameSite=Lax`;
const clear=n=>`${n}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

async function admin(req,e){
 const u=new URL(req.url), c=req.headers.get("cookie")||"", m=c.match(/ry_admin=([^;]+)/);
 if(u.pathname==="/api/admin/login"&&req.method==="POST"){
  const b=await req.json().catch(()=>({}));
  if(!e.ADMIN_PASSWORD||b.password!==e.ADMIN_PASSWORD)return json({error:"رمز مدیریت اشتباه است"},401);
  return json({ok:true},200,{"Set-Cookie":cookie("ry_admin",await token({role:"admin",exp:Date.now()+43200000},e.ADMIN_PASSWORD),43200)});
 }
 if(u.pathname==="/api/admin/logout"&&req.method==="POST")return json({ok:true},200,{"Set-Cookie":clear("ry_admin")});
 const s=m?await verify(m[1],e.ADMIN_PASSWORD||""):null;if(!s)return json({error:"unauthorized"},401);

 if(u.pathname==="/api/admin/codes"&&req.method==="GET"){
  const r=await e.DB.prepare(`SELECT ac.id,ac.code,ac.status,ac.device_bound_at,ac.created_at,(SELECT COUNT(*) FROM code_courses cc WHERE cc.code_id=ac.id AND cc.active=1) active_courses FROM access_codes ac ORDER BY ac.id DESC`).all();return json(r.results)
 }
 if(u.pathname==="/api/admin/codes"&&req.method==="POST"){
  const b=await req.json(),code=String(b.code||"").trim().toUpperCase();
  if(!/^RY\d+$/.test(code))return json({error:"کد باید مثل RY123456 باشد"},400);
  try{await e.DB.prepare("INSERT INTO access_codes(code) VALUES(?)").bind(code).run();return json({ok:true})}catch{return json({error:"این کد قبلاً وجود دارد"},409)}
 }
 const cc=u.pathname.match(/^\/api\/admin\/codes\/(\d+)\/courses$/);
 if(cc&&req.method==="GET"){
  const r=await e.DB.prepare(`SELECT c.id,c.title,COALESCE(cc.active,0) active FROM courses c LEFT JOIN code_courses cc ON cc.course_id=c.id AND cc.code_id=? ORDER BY c.id DESC`).bind(cc[1]).all();return json(r.results)
 }
 if(cc&&req.method==="POST"){
  const b=await req.json();await e.DB.prepare(`INSERT INTO code_courses(code_id,course_id,active) VALUES(?,?,?) ON CONFLICT(code_id,course_id) DO UPDATE SET active=excluded.active`).bind(cc[1],Number(b.course_id),b.active?1:0).run();return json({ok:true})
 }
 if(u.pathname==="/api/admin/courses"&&req.method==="GET"){
  const r=await e.DB.prepare(`SELECT c.id,c.title,c.description,c.created_at,COUNT(m.id) media_count FROM courses c LEFT JOIN media m ON m.course_id=c.id GROUP BY c.id ORDER BY c.id DESC`).all();return json(r.results)
 }
 if(u.pathname==="/api/admin/courses"&&req.method==="POST"){
  const b=await req.json(),title=String(b.title||"").trim();if(!title)return json({error:"نام دوره الزامی است"},400);
  const r=await e.DB.prepare("INSERT INTO courses(title,description) VALUES(?,?) RETURNING id,title,description").bind(title,String(b.description||"")).first();return json(r,201)
 }
 const up=u.pathname.match(/^\/api\/admin\/courses\/(\d+)\/media$/);
 if(up&&req.method==="POST"){
  if(!e.MEDIA)return json({error:"R2 وصل نشده است"},500);
  const fd=await req.formData(),f=fd.get("file");if(!(f instanceof File))return json({error:"فایل ارسال نشده"},400);
  if(!/^audio\/|^video\//.test(f.type))return json({error:"فقط صوت یا ویدیو مجاز است"},400);
  if(f.size>500*1024*1024)return json({error:"حداکثر حجم فایل ۵۰۰ مگابایت است"},400);
  const ext=(f.name.match(/\.[A-Za-z0-9]+$/)||[""])[0].toLowerCase(),key=`courses/${up[1]}/${crypto.randomUUID()}${ext}`;
  await e.MEDIA.put(key,f.stream(),{httpMetadata:{contentType:f.type}});
  const r=await e.DB.prepare("INSERT INTO media(course_id,title,type,object_key,mime_type) VALUES(?,?,?,?,?) RETURNING id,title,type").bind(up[1],String(fd.get("title")||f.name),f.type.startsWith("audio/")?"audio":"video",key,f.type).first();return json(r,201)
 }
 return json({error:"not found"},404)
}

async function user(req,e){
 const u=new URL(req.url);
 if(u.pathname==="/api/login"&&req.method==="POST"){
  const b=await req.json().catch(()=>({})),code=String(b.code||"").trim().toUpperCase(),device=String(b.device_id||"");
  if(!/^RY\d+$/.test(code)||!device)return json({error:"کد یا دستگاه نامعتبر است"},400);
  const row=await e.DB.prepare("SELECT * FROM access_codes WHERE code=? AND status='active'").bind(code).first();
  if(!row)return json({error:"کد پیدا نشد یا غیرفعال است"},404);
  const dh=await hash(device);
  if(row.device_id_hash&&row.device_id_hash!==dh)return json({error:"این کد قبلاً روی دستگاه دیگری فعال شده است"},403);
  if(!row.device_id_hash)await e.DB.prepare("UPDATE access_codes SET device_id_hash=?,device_bound_at=CURRENT_TIMESTAMP WHERE id=?").bind(dh,row.id).run();
  const t=await token({codeId:row.id,exp:Date.now()+2592000000},e.SESSION_SECRET);
  return json({ok:true},200,{"Set-Cookie":cookie("ry_user",t)})
 }
 const c=req.headers.get("cookie")||"",m=c.match(/ry_user=([^;]+)/),s=m?await verify(m[1],e.SESSION_SECRET||""):null;if(!s)return json({error:"unauthorized"},401);
 if(u.pathname==="/api/me"){const r=await e.DB.prepare(`SELECT c.id,c.title,c.description FROM code_courses cc JOIN courses c ON c.id=cc.course_id WHERE cc.code_id=? AND cc.active=1 ORDER BY c.id DESC`).bind(s.codeId).all();return json({courses:r.results})}
 const cr=u.pathname.match(/^\/api\/courses\/(\d+)$/);
 if(cr){const c=await e.DB.prepare(`SELECT c.id,c.title,c.description FROM courses c JOIN code_courses cc ON cc.course_id=c.id WHERE c.id=? AND cc.code_id=? AND cc.active=1`).bind(cr[1],s.codeId).first();if(!c)return json({error:"دسترسی ندارید"},403);const r=await e.DB.prepare("SELECT id,title,type FROM media WHERE course_id=? ORDER BY id").bind(cr[1]).all();return json({...c,media:r.results})}
 const mr=u.pathname.match(/^\/api\/media\/(\d+)$/);
 if(mr){const m=await e.DB.prepare(`SELECT x.object_key,x.mime_type FROM media x JOIN code_courses cc ON cc.course_id=x.course_id WHERE x.id=? AND cc.code_id=? AND cc.active=1`).bind(mr[1],s.codeId).first();if(!m)return json({error:"دسترسی ندارید"},403);const o=await e.MEDIA.get(m.object_key);if(!o)return json({error:"فایل پیدا نشد"},404);return new Response(o.body,{headers:{"content-type":m.mime_type||"application/octet-stream","cache-control":"private,no-store"}})}
 return json({error:"not found"},404)
}

export default {async fetch(req,env){const u=new URL(req.url);try{if(u.pathname.startsWith("/api/admin/"))return admin(req,env);if(u.pathname.startsWith("/api/"))return user(req,env);return env.ASSETS.fetch(req)}catch(err){return json({error:"server_error",message:String(err?.message||err)},500)}}};
