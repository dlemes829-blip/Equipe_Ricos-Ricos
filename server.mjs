import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import webpush from 'web-push';
import {storage,operation} from './lib/storage.mjs';
import {MANAGERS,assert,hashPassword,sha256,cookieValue,sessionCookie,clearCookie,publicUser,isDev,isPrivileged,requireDev,requireSupervisor,validUsername,validateState} from './lib/auth.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url)));
const staticFiles=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css'],['/sw.js','sw.js'],['/icon.svg','icon.svg'],['/core.mjs','core.mjs']].map(([url,path])=>[url,{bytes:fs.readFileSync(new URL('./public/'+path,import.meta.url)),type:path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8'}]));
const origins=new Set([process.env.APP_ORIGIN,process.env.RENDER_EXTERNAL_URL].filter(Boolean));
const secured={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",'Strict-Transport-Security':'max-age=31536000'};
const limits=new Map(),touches=new Map();
if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'https://gestao-equipe-amanda.onrender.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
function limited(req,key,max=12){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim(),id=key+':'+ip,t=Date.now(),r=limits.get(id)||{time:t,n:0};if(t-r.time>300000){r.time=t;r.n=0}r.n++;limits.set(id,r);if(limits.size>10000)for(const[k,v]of limits)if(t-v.time>300000)limits.delete(k);assert(r.n<=max,'Muitas tentativas. Aguarde alguns minutos.',429)}
async function body(req,max=6000000){assert(String(req.headers['content-type']||'').startsWith('application/json'),'Envie dados JSON.');let size=0,chunks=[];for await(const c of req){size+=c.length;assert(size<=max,'Dados excedem o limite permitido.',413);chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{assert(false,'JSON inválido.')}}
function csrf(req){if(['GET','HEAD','OPTIONS'].includes(req.method))return;const origin=req.headers.origin;assert(origin,'Origem inválida.',403);const allowed=origins.size?origins:new Set(['https://'+req.headers.host,'http://localhost:'+process.env.PORT]);assert(allowed.has(origin),'Origem inválida.',403);assert(req.headers['sec-fetch-site']!=='cross-site','Origem inválida.',403)}
async function userFor(req){const token=cookieValue(req);assert(/^[a-zA-Z0-9_-]{43}$/.test(token),'Entre para continuar.',401);const session_hash=sha256(token),u=await operation('session_get',{session_hash});assert(u.status==='approved','Acesso não autorizado.',401);return {...u,session_hash}}
const op=(user,action,input={})=>operation(action,{...input,session_hash:user.session_hash});
const audit=(u,action,target,detail={})=>op(u,'audit',{action,target_id:target,detail}).catch(()=>console.error('Audit operation unavailable'));
function ownSeed(user){const privileged=isPrivileged(user),ids=new Set(seed.units.filter(u=>privileged||u.manager===user.manager).map(u=>u.id));return {teamMembers:seed.teamMembers,sheetCatalog:seed.sheetCatalog,merit:seed.merit.filter(r=>privileged||r.manager===user.manager),meritTargets:seed.meritTargets.filter(r=>privileged||r.manager===user.manager),campaignMeta:Object.fromEntries(Object.entries(seed.campaignMeta).filter(([id])=>ids.has(id))),suggestedDaily:privileged?seed.suggestedDaily:{[user.manager]:seed.suggestedDaily[user.manager]}}}
async function stateGet(user){return storage('GET',null,null,'',user.session_hash)}
function validateSubscription(s){assert(s&&typeof s.endpoint==='string'&&s.keys&&/^[A-Za-z0-9_-]{60,160}$/.test(s.keys.p256dh||'')&&/^[A-Za-z0-9_-]{16,64}$/.test(s.keys.auth||''),'Inscrição de notificações inválida.');let url;try{url=new URL(s.endpoint)}catch{assert(false,'Endereço de notificações inválido.')}const allowed=['fcm.googleapis.com','push.services.mozilla.com','web.push.apple.com','notify.windows.com'];assert(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&allowed.some(h=>url.hostname===h||url.hostname.endsWith('.'+h)),'Provedor de notificações não suportado.');}
async function sendPush(user,notice,target){if(!process.env.VAPID_PRIVATE_KEY)return {sent:0,subscribed:0};const [subscriptions,people]=await Promise.all([op(user,'push_list',{user_id:target||null}),op(user,'people_list')]);const approved=new Set(people.map(p=>p.id));let sent=0;for(const s of subscriptions.filter(s=>approved.has(s.user_id))){try{await webpush.sendNotification(s.subscription,JSON.stringify({id:notice.id,title:notice.title,body:notice.body}),{TTL:3600,timeout:10000});sent++}catch(e){if(e.statusCode===404||e.statusCode===410)await op(user,'push_delete',{id:s.id})}}return {sent,subscribed:subscriptions.length}}
const server=http.createServer(async(req,res)=>{
 const send=(status,data,headers={})=>{res.writeHead(status,{...secured,'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data))};
 try{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(path==='/health')return send(200,{ok:true});
  if(staticFiles.has(path)&&req.method==='GET'){const f=staticFiles.get(path);res.writeHead(200,{...secured,'Content-Type':f.type,...(path==='/sw.js'?{'Service-Worker-Allowed':'/'}:{})});return res.end(f.bytes)}
  csrf(req);
  if(path==='/api/auth/login'&&req.method==='POST'){
   limited(req,'login',18);const b=await body(req,4000),username=String(b.username||'').trim().toLowerCase();assert(validUsername(username)&&typeof b.password==='string'&&b.password.length<=200,'Usuário ou senha inválidos.',401);
   const token=crypto.randomBytes(32).toString('base64url'),u=await operation('login',{username,password:b.password,token_hash:sha256(token)});await audit({...u,session_hash:sha256(token)},'login',u.id);return send(200,{user:publicUser(u)},{'Set-Cookie':sessionCookie(token)});
  }
  if(path==='/api/auth/request'&&req.method==='POST'){
   limited(req,'signup',8);const b=await body(req,5000),username=String(b.username||'').trim().toLowerCase(),name=String(b.name||'').trim();assert(validUsername(username),'Use 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado no usuário.');assert(name.length>=3&&name.length<=120,'Informe seu nome.');assert(typeof b.password==='string'&&b.password.length>=8&&b.password.length<=128,'Use uma senha entre 8 e 128 caracteres.');assert(!b.manager||MANAGERS.includes(b.manager),'Gerente inválido.');await operation('user_register',{username,name,password_hash:hashPassword(b.password),requested_manager:b.manager||null,requested_role:b.role==='supervisor'?'supervisor':'manager'});return send(201,{ok:true,message:'Solicitação enviada. Aguarde a aprovação do desenvolvedor.'});
  }
  const user=await userFor(req);
  if(path==='/api/auth/me'&&req.method==='GET')return send(200,{user:publicUser(user)});
  if(path==='/api/auth/logout'&&req.method==='POST'){const b=await body(req,3000);if(b.endpoint)await op(user,'push_unsubscribe',{endpoint:b.endpoint});await op(user,'session_revoke');return send(200,{ok:true},{'Set-Cookie':clearCookie})}
  if(path==='/api/auth/password'&&req.method==='POST'){const b=await body(req,3000);assert(typeof b.password==='string'&&b.password.length>=8&&b.password.length<=128,'A nova senha deve ter de 8 a 128 caracteres.');await op(user,'password_update',{current_password:b.currentPassword,password_hash:hashPassword(b.password)});return send(200,{ok:true},{'Set-Cookie':clearCookie})}
  if(path==='/api/presence'&&req.method==='POST'){if(Date.now()-(touches.get(user.id)||0)>30000){await op(user,'touch');touches.set(user.id,Date.now())}return send(200,{ok:true,user:publicUser(user)})}
  if(path==='/api/seed'&&req.method==='GET')return send(200,ownSeed(user));
  if(path==='/api/state'&&req.method==='GET'){const r=await stateGet(user);return send(200,r.data,{'X-State-Version':r.version})}
  if(path==='/api/state'&&req.method==='PUT'){
   limited(req,'save:'+user.id,120);const b=await body(req);const {overview,...clean}=b;validateState(clean);const r=await storage('PUT',clean,req.headers['if-match'],'',user.session_hash);await audit(user,'state_saved',null,{manager:user.manager});return send(200,r.data,{'X-State-Version':r.version});
  }
  if(path==='/api/admin/users'&&req.method==='GET'){requireDev(user);return send(200,await op(user,'user_list'))}
  if(path.startsWith('/api/admin/users/')&&req.method==='PUT'){
   requireDev(user);const b=await body(req,4000),id=path.split('/').at(-1);assert(/^[a-f0-9-]{36}$/.test(id),'Usuário inválido.');assert(['pending','approved','blocked','rejected'].includes(b.status),'Status inválido.');assert(Array.isArray(b.roles)&&b.roles.every(r=>['manager','supervisor','developer'].includes(r)),'Perfil inválido.');assert(!b.roles.includes('manager')||MANAGERS.includes(b.manager),'Atribua a carteira do gerente.');const rows=await op(user,'user_update',{id,status:b.status,roles:b.roles,manager:b.manager||null,is_pro:!!b.is_pro});await audit(user,'user_permissions_updated',id,{status:b.status,roles:b.roles,manager:b.manager||null,is_pro:!!b.is_pro});return send(200,rows);
  }
  if(path==='/api/admin/audit'&&req.method==='GET'){requireDev(user);return send(200,await op(user,'audit_list'))}
  if(path==='/api/people'&&req.method==='GET'){requireSupervisor(user);return send(200,await op(user,'people_list'))}
  if(path==='/api/notifications'&&req.method==='GET')return send(200,await op(user,'notice_list'));
  if(path==='/api/notifications'&&req.method==='POST'){
   requireSupervisor(user);limited(req,'notices:'+user.id,30);const b=await body(req,8000);assert(typeof b.title==='string'&&b.title.trim().length>0&&b.title.length<=120&&typeof b.body==='string'&&b.body.trim().length>0&&b.body.length<=3000,'Informe título e mensagem válidos.');if(b.recipientId){const people=await op(user,'people_list');assert(people.some(p=>p.id===b.recipientId),'Destinatário inválido.');}const rows=await op(user,'notice_create',{title:b.title.trim(),body:b.body.trim(),recipient_id:b.recipientId||null});const delivery=await sendPush(user,rows[0],b.recipientId);await audit(user,'notification_created',rows[0].id,{recipient:b.recipientId||'all'});return send(201,{notification:rows[0],delivery});
  }
  if(path.startsWith('/api/notifications/')&&req.method==='POST'){const id=path.split('/').at(-1);return send(200,await op(user,'notice_read',{notification_id:id}))}
  if(path==='/api/push/key'&&req.method==='GET')return send(200,{publicKey:process.env.VAPID_PUBLIC_KEY||null});
  if(path==='/api/push/subscribe'&&req.method==='POST'){const b=await body(req,10000);validateSubscription(b);await op(user,'push_save',{subscription:b});return send(200,{ok:true})}
  if(path==='/api/push/unsubscribe'&&req.method==='POST'){const b=await body(req,3000);await op(user,'push_unsubscribe',{endpoint:b.endpoint});return send(200,{ok:true})}
  if(path==='/api/features'&&req.method==='GET')return send(200,await op(user,'feature_list'));
  if(path==='/api/features'&&req.method==='POST'){requireSupervisor(user);const b=await body(req,10000);assert(typeof b.title==='string'&&b.title.trim().length>0&&b.title.length<=120&&typeof b.description==='string'&&b.description.trim().length>0&&b.description.length<=5000,'Descreva a melhoria.');const rows=await op(user,'feature_create',{sheet_id:String(b.sheetId||'panel').slice(0,80),title:b.title.trim(),description:b.description.trim()});await audit(user,'feature_requested',rows[0].id,{sheet:b.sheetId});return send(201,rows[0])}
  if(path.startsWith('/api/features/')&&req.method==='PUT'){requireDev(user);const b=await body(req,8000);return send(200,await op(user,'feature_update',{id:path.split('/').at(-1),status:b.status,developer_note:b.note||''}))}
  if(path.startsWith('/api/sheets/')&&req.method==='GET'){const sheetId=path.split('/').at(-1);assert(seed.sheetCatalog.some(s=>s.id===sheetId),'Aba inválida.');return send(200,await op(user,'sheet_list',{sheet_id:sheetId,manager:isPrivileged(user)?url.searchParams.get('manager'):user.manager,offset:Math.max(0,Number(url.searchParams.get('offset'))||0)}))}
  if(path.startsWith('/api/sheets/')&&req.method==='POST'){const sheetId=path.split('/').at(-1);assert(seed.sheetCatalog.some(s=>s.id===sheetId),'Aba inválida.');const b=await body(req,60000);assert(b.data&&typeof b.data==='object'&&!Array.isArray(b.data),'Registro inválido.');const rows=await op(user,'sheet_insert',{sheet_id:sheetId,owner_manager:isPrivileged(user)?b.manager||null:user.manager,data:b.data});await audit(user,'sheet_record_created',rows[0].id,{sheet:sheetId});return send(201,rows[0])}
  if(path.startsWith('/api/records/')&&req.method==='PUT'){const b=await body(req,60000),id=path.split('/').at(-1);assert(b.data&&typeof b.data==='object'&&!Array.isArray(b.data),'Registro inválido.');const rows=await op(user,'sheet_update',{id,version:b.version,owner_manager:isPrivileged(user)?b.manager||null:user.manager,data:b.data});assert(rows.length,'O registro foi atualizado por outra pessoa. Reabra antes de salvar.',409);await audit(user,'sheet_record_updated',id);return send(200,rows[0])}
  return send(404,{error:'Recurso não encontrado.'});
 }catch(error){const status=error.status||500;if(status>=500)console.error('Request failed',status);send(status,{error:status>=500?'Serviço temporariamente indisponível. Tente novamente.':error.message},status===401?{'Set-Cookie':clearCookie}:{})}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
