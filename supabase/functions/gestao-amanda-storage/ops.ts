import {browserAgentOperation,browserUserOperation} from './browser-ops.mjs';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { MANAGERS, assert, requireDev, requireSupervisor, isPrivileged } from './access.mjs';
const USER_PUBLIC='id,username,name,status,roles,manager,requested_manager,requested_role,is_pro,last_seen_at,created_at';
function verify(password,hash){const p=String(hash||'').split(':'),ok=p[0]==='scrypt'&&/^[a-f0-9]{32}$/.test(p[1]||'')&&/^[a-f0-9]{128}$/.test(p[2]||'');const salt=ok?p[1]:'0'.repeat(32),expected=Buffer.from(ok?p[2]:'0'.repeat(128),'hex'),actual=scryptSync(String(password),Buffer.from(salt,'hex'),64);return timingSafeEqual(actual,expected)&&ok}
export async function sessionUser(hash,db){assert(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash),'Sessão necessária.',401);const rows=await db('amanda_sessions',{token_hash:'eq.'+hash,expires_at:'gt.'+new Date().toISOString(),select:'user:amanda_users('+USER_PUBLIC+')',limit:1});assert(rows[0]?.user?.status==='approved','Sessão inválida ou acesso bloqueado.',401);const u=rows[0].user;assert(isPrivileged(u)||(u.roles.includes('manager')&&MANAGERS.includes(u.manager)),'Carteira não atribuída.',403);return u}
export async function operations(action:string,input:any,db:any){
 if(action.startsWith('browser_agent_'))return browserAgentOperation(action,input,db);
 const q=(table:string,params:any={},method='GET',body?:any)=>db(table,params,method,body);
 if(action==='login'){
  assert(typeof input.username==='string'&&/^[a-z0-9_.-]{3,40}$/.test(input.username)&&typeof input.password==='string'&&input.password.length<=200,'Usuário ou senha inválidos.',401);
  const attempts=await q('amanda_login_attempts',{attempt_key:'eq.'+input.username,created_at:'gte.'+new Date(Date.now()-15*60*1000).toISOString(),select:'id',limit:8});assert(attempts.length<8,'Muitas tentativas. Aguarde 15 minutos.',429);
  const rows=await q('amanda_users',{username:'eq.'+input.username,select:'*',limit:1}),u=rows[0];
  if(!verify(input.password,u?.password_hash)){await q('amanda_login_attempts',{},'POST',{attempt_key:input.username});assert(false,'Usuário ou senha inválidos.',401)}
  assert(u.status==='approved',u.status==='pending'?'Seu acesso aguarda aprovação.':'Acesso bloqueado ou recusado.',403);
  assert(/^[a-f0-9]{64}$/.test(input.token_hash||''),'Sessão inválida.');
  await q('amanda_sessions',{},'POST',{token_hash:input.token_hash,user_id:u.id,expires_at:new Date(Date.now()+8*60*60*1000).toISOString()});
  await q('amanda_login_attempts',{attempt_key:'eq.'+input.username},'DELETE');
  const {password_hash,...safe}=u;return safe;
 }
 if(action==='user_register'){
  assert(/^[a-z0-9_.-]{3,40}$/.test(input.username||'')&&/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(input.password_hash||'')&&typeof input.name==='string'&&input.name.length>=3&&input.name.length<=120,'Cadastro inválido.');
  assert(!input.requested_manager||MANAGERS.includes(input.requested_manager),'Gerente inválido.');
  await q('amanda_users',{},'POST',{username:input.username,name:input.name,password_hash:input.password_hash,requested_manager:input.requested_manager||null,requested_role:input.requested_role==='supervisor'?'supervisor':'manager'});return {ok:true};
 }
 const actor=await sessionUser(input.session_hash,db);
 if(action.startsWith('browser_'))return browserUserOperation(action,input,actor,db);
 switch(action){
  case 'user_list':requireDev(actor);return q('amanda_users',{select:USER_PUBLIC,order:'created_at.desc',limit:500});
  case 'people_list':requireSupervisor(actor);return q('amanda_users',{status:'eq.approved',select:'id,name,username,manager',limit:500});
  case 'user_update':{
   requireDev(actor);assert(input.id!==actor.id||(input.status==='approved'&&input.roles?.includes('developer')),'Não é permitido bloquear ou remover seu próprio acesso de desenvolvedor.');
   assert(['approved','pending','blocked','rejected'].includes(input.status)&&Array.isArray(input.roles)&&(input.status!=='approved'||input.roles.length>0)&&input.roles.every(r=>['manager','supervisor','developer'].includes(r)),'Perfil inválido.');assert(!input.manager||MANAGERS.includes(input.manager),'Carteira inválida.');assert(!input.roles.includes('manager')||MANAGERS.includes(input.manager),'Atribua uma carteira ao gerente.');
   const fields={status:input.status,roles:input.roles,manager:input.manager||null,is_pro:!!input.is_pro};
   const result=await q('amanda_users',{id:'eq.'+input.id,select:USER_PUBLIC},'PATCH',fields);
   if(input.status!=='approved')await q('amanda_sessions',{user_id:'eq.'+input.id},'DELETE');return result;
  }
  case 'password_update':{const u=(await q('amanda_users',{id:'eq.'+actor.id,select:'password_hash',limit:1}))[0];assert(verify(input.current_password,u?.password_hash),'Senha atual incorreta.',403);assert(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(input.password_hash||''),'Senha inválida.');await q('amanda_users',{id:'eq.'+actor.id},'PATCH',{password_hash:input.password_hash});await q('amanda_sessions',{user_id:'eq.'+actor.id},'DELETE');return {ok:true};}
  case 'session_get':return actor;
  case 'session_revoke':await q('amanda_sessions',{token_hash:'eq.'+input.session_hash},'DELETE');return {ok:true};
  case 'touch':await q('amanda_users',{id:'eq.'+actor.id},'PATCH',{last_seen_at:new Date().toISOString()});return {ok:true};
  case 'audit':await q('amanda_audit',{},'POST',{actor_id:actor.id,action:input.action,target_id:input.target_id||null,detail:input.detail||{}});return {ok:true};
  case 'audit_list':requireDev(actor);return q('amanda_audit',{select:'*',order:'created_at.desc',limit:100});
  case 'notice_list':{
   const notices=await q('amanda_notifications',{or:'(recipient_id.is.null,recipient_id.eq.'+actor.id+')',select:'*',order:'created_at.desc',limit:100});
   const reads=await q('amanda_notification_reads',{user_id:'eq.'+actor.id,select:'notification_id',limit:1000});
   const seen=new Set(reads.map((r:any)=>r.notification_id));return notices.map((n:any)=>({...n,read:seen.has(n.id)}));
  }
  case 'notice_create':requireSupervisor(actor);assert(typeof input.title==='string'&&input.title.length>0&&input.title.length<=120&&typeof input.body==='string'&&input.body.length<=3000,'Aviso inválido.');return q('amanda_notifications',{},'POST',{sender_id:actor.id,recipient_id:input.recipient_id||null,title:input.title,body:input.body});
  case 'notice_read':{const n=(await q('amanda_notifications',{id:'eq.'+input.notification_id,select:'recipient_id',limit:1}))[0];assert(n&&(!n.recipient_id||n.recipient_id===actor.id),'Aviso não disponível.',403);return q('amanda_notification_reads',{on_conflict:'user_id,notification_id'},'UPSERT',{user_id:actor.id,notification_id:input.notification_id});}
  case 'push_save':return q('amanda_push_subscriptions',{on_conflict:'endpoint'},'UPSERT',{user_id:actor.id,endpoint:input.subscription.endpoint,subscription:input.subscription});
  case 'push_list':requireSupervisor(actor);return q('amanda_push_subscriptions',{...(input.user_id?{user_id:'eq.'+input.user_id}:{}),select:'*',limit:1000});
  case 'push_delete':requireSupervisor(actor);await q('amanda_push_subscriptions',{id:'eq.'+input.id},'DELETE');return {ok:true};
  case 'push_unsubscribe':await q('amanda_push_subscriptions',{user_id:'eq.'+actor.id,...(input.endpoint?{endpoint:'eq.'+input.endpoint}:{})},'DELETE');return {ok:true};
  case 'feature_create':requireSupervisor(actor);assert(typeof input.title==='string'&&input.title.length<=120&&typeof input.description==='string'&&input.description.length<=5000,'Pedido inválido.');return q('amanda_feature_requests',{},'POST',{requester_id:actor.id,sheet_id:input.sheet_id,title:input.title,description:input.description});
  case 'feature_list':return q('amanda_feature_requests',{...(!actor.roles.includes('developer')?{requester_id:'eq.'+actor.id}:{}),select:'*',order:'created_at.desc',limit:200});
  case 'feature_update':requireDev(actor);assert(['new','in_progress','done','rejected'].includes(input.status),'Status inválido.');return q('amanda_feature_requests',{id:'eq.'+input.id,select:'*'},'PATCH',{status:input.status,developer_note:String(input.developer_note||'').slice(0,3000),updated_at:new Date().toISOString()});
  case 'sheet_list':return q('amanda_sheet_records',{sheet_id:'eq.'+input.sheet_id,...(!isPrivileged(actor)?{owner_manager:'eq.'+actor.manager}:input.manager?{owner_manager:'eq.'+input.manager}:{}),select:'*',order:'source_row.asc.nullslast,updated_at.desc',limit:200,offset:Math.max(0,Number(input.offset)||0)});
  case 'sheet_get':{const row=(await q('amanda_sheet_records',{id:'eq.'+input.id,select:'*',limit:1}))[0];assert(row&&(isPrivileged(actor)||row.owner_manager===actor.manager),'Registro não disponível.',403);return row;}
  case 'sheet_insert':assert(input.data&&JSON.stringify(input.data).length<50000,'Registro inválido.');return q('amanda_sheet_records',{},'POST',{sheet_id:input.sheet_id,owner_manager:isPrivileged(actor)?input.owner_manager:actor.manager,data:input.data,created_by:actor.id,source:false});
  case 'sheet_update':{const row=(await q('amanda_sheet_records',{id:'eq.'+input.id,select:'owner_manager',limit:1}))[0];assert(row&&(isPrivileged(actor)||row.owner_manager===actor.manager),'Registro não disponível.',403);assert(input.data&&JSON.stringify(input.data).length<50000,'Registro inválido.');return q('amanda_sheet_records',{id:'eq.'+input.id,version:'eq.'+input.version,select:'*'},'PATCH',{data:input.data,owner_manager:isPrivileged(actor)?input.owner_manager:actor.manager,version:crypto.randomUUID(),updated_at:new Date().toISOString()});}
  default:throw Error('Unknown action');
 }
}
