import {assert,requireDev,MANAGERS,isPrivileged} from './access.mjs';
import {validateBrowserConfig,parseBrowserReport} from './reporting.mjs';
export const AGENT_SHA256='f7af48655fafa425ba66894db4d78a6eef987d24bd66f127b6505538fd5e6375';
const get=async(db,table)=>{const rows=await db(table,{id:'eq.1',select:'*',limit:1});return rows[0]||null};
const jobPublic=r=>({id:r.id,kind:r.kind,status:r.status,created_at:r.created_at,updated_at:r.updated_at,date:r.payload.date,manager:r.payload.manager,progress:r.payload.progress||0,message:r.payload.message||'',count:r.payload.count||0,skipped:r.payload.skipped||0});
async function authAgent(token){assert(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token),'Unauthorized',401);const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));assert(Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')===AGENT_SHA256,'Unauthorized',401)}
export async function browserAgentOperation(action,input,db){
 await authAgent(input.agent_token);
 if(action==='browser_agent_state')return {config:(await get(db,'amanda_browser_config'))?.payload||{homepage:'',allowedOrigins:[],flows:{}},profile:(await get(db,'amanda_browser_vault'))?.payload||null};
 if(action==='browser_agent_profile'){
  assert(input.profile&&typeof input.profile==='object'&&Array.isArray(input.profile.storage?.cookies)&&JSON.stringify(input.profile).length<4000000,'Invalid profile');
  await db('amanda_browser_vault',{on_conflict:'id'},'UPSERT',{id:1,payload:input.profile,updated_at:new Date().toISOString()});return {ok:true};
 }
 if(action==='browser_agent_claim'){
  const active=await db('amanda_report_jobs',{status:'eq.running',select:'*',limit:1});
  if(active.length&&Date.now()-Date.parse(active[0].updated_at)<12*60000)return {job:null};
  if(active.length)await db('amanda_report_jobs',{id:'eq.'+active[0].id,status:'eq.running'},'PATCH',{status:'failed',payload:{...active[0].payload,message:'A execução foi interrompida. Solicite o relatório novamente.'},updated_at:new Date().toISOString()});
  const rows=await db('amanda_report_jobs',{status:'eq.queued',select:'*',order:'created_at.asc',limit:1});if(!rows.length)return {job:null};const j=rows[0],run=crypto.randomUUID();
  const claimed=await db('amanda_report_jobs',{id:'eq.'+j.id,status:'eq.queued',select:'*'},'PATCH',{status:'running',payload:{...j.payload,run,progress:1,message:'Abrindo o Sisodonto…'},updated_at:new Date().toISOString()});
  if(!claimed.length)return {job:null};return {job:claimed[0],config:(await get(db,'amanda_browser_config'))?.payload};
 }
 if(action==='browser_agent_finish'||action==='browser_agent_progress'){
  const rows=await db('amanda_report_jobs',{id:'eq.'+input.id,select:'*',limit:1}),j=rows[0];assert(j,'Job not found',404);if(j.status==='done')return {ok:true,count:j.payload.count};assert(j.status==='running'&&j.payload.run===input.run,'Job unavailable',409);
  const now=new Date().toISOString();
  if(action==='browser_agent_progress'){await db('amanda_report_jobs',{id:'eq.'+j.id,status:'eq.running'},'PATCH',{payload:{...j.payload,progress:Math.max(1,Math.min(95,Number(input.progress)||1)),message:'Executando etapa '+Math.max(1,Number(input.step)||1)+' do relatório…'},updated_at:now});return {ok:true}}
  if(input.failed){await db('amanda_report_jobs',{id:'eq.'+j.id,status:'eq.running'},'PATCH',{status:'failed',payload:{...j.payload,message:String(input.message||'Não foi possível ler o relatório. Verifique a sessão e o caminho no Admin.').slice(0,250)},updated_at:now});return {ok:true}}
  const user=(await db('amanda_users',{id:'eq.'+j.requested_by,select:'id,status,roles,manager',limit:1}))[0];assert(user?.status==='approved'&&(isPrivileged(user)||user.manager===j.payload.manager),'Solicitante sem acesso à carteira.',403);
  assert(input.result&&JSON.stringify(input.result).length<5000000,'Report exceeds limit');
  let count=0,skipped=0,done=false;
  for(let attempt=0;attempt<4;attempt++){
   const stored=await get(db,'gestao_amanda_state'),s=stored.payload;
   const previous=s.history.find(h=>h.browserJob===j.id);if(previous){done=true;count=previous.count||0;break}
   const units=s.units.filter(u=>u.manager===j.payload.manager),parsed=parseBrowserReport(j.kind,input.result,units,j.payload.date,j.payload.period);count=parsed.rows.length;skipped=parsed.skipped;
   const key=j.kind==='chairs'?'chairs':'evals',existing=s[key].filter(r=>!parsed.rows.some(n=>n.id===r.id&&n.date===r.date&&(key==='chairs'||n.period===r.period)));
   const importedRows=parsed.rows.map(r=>({...r,importId:j.id,capturedAt:now})),summaries=(parsed.summaries||[]).map(r=>({...r,importId:j.id,capturedAt:now}));
   const payload={...s,[key]:existing.concat(importedRows),...(j.kind==='evaluations'?{evaluationSummaries:(s.evaluationSummaries||[]).filter(r=>!(r.manager===j.payload.manager&&r.date===j.payload.date&&r.period===j.payload.period)).concat(summaries)}:{}),history:s.history.concat({browserJob:j.id,created:now,createdBy:'browser-worker',manager:j.payload.manager,kind:'Sisodonto: '+j.kind,date:j.payload.date,count}).slice(-10000)};
   const saved=await db('gestao_amanda_state',{id:'eq.1',version:'eq.'+stored.version,select:'version'},'PATCH',{payload,version:crypto.randomUUID(),updated_at:now});if(saved.length){done=true;break}
  }
  assert(done,'Atualização concorrente. Tente novamente.',409);
  await db('amanda_report_jobs',{id:'eq.'+j.id,status:'eq.running'},'PATCH',{status:'done',payload:{...j.payload,progress:100,count,skipped,message:(j.kind==='evaluations'?count+' unidades detalhadas e resumo de avaliações conferido.':count+' clínicas atualizadas.')+' Apenas a carteira solicitada foi importada.'},updated_at:now});return {ok:true,count};
 }
 throw Error('Unknown agent operation');
}
export async function browserUserOperation(action,input,actor,db){
 if(action==='browser_config_get'){requireDev(actor);return (await get(db,'amanda_browser_config'))?.payload||{homepage:'',allowedOrigins:[],flows:{}}}
 if(action==='browser_config_set'){requireDev(actor);let payload;try{payload=validateBrowserConfig(input.config)}catch(e){assert(false,e.message)}await db('amanda_browser_config',{on_conflict:'id'},'UPSERT',{id:1,payload,updated_at:new Date().toISOString()});return payload}
 if(action==='browser_status'){const config=(await get(db,'amanda_browser_config'))?.payload;const vault=await db('amanda_browser_vault',{id:'eq.1',select:'updated_at',limit:1});return {configured:{chairs:!!config?.flows?.chairs?.enabled,evaluations:!!config?.flows?.evaluations?.enabled},sessionSaved:!!vault.length,sessionUpdatedAt:vault[0]?.updated_at||null}}
 if(action==='browser_job_create'){
  assert(['chairs','evaluations'].includes(input.kind),'Relatório inválido.');assert(/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')&&!Number.isNaN(Date.parse(input.date)),'Data inválida.');assert(['Antes das 18h','Depois das 18h'].includes(input.period),'Retrato inválido.');
  const manager=isPrivileged(actor)?input.manager||actor.manager:actor.manager;assert(MANAGERS.includes(manager),'Selecione uma carteira.');const config=(await get(db,'amanda_browser_config'))?.payload;assert(config?.flows?.[input.kind]?.enabled,'O desenvolvedor ainda precisa configurar e ativar o caminho deste relatório.',409);assert((await get(db,'amanda_browser_vault'))?.payload,'Entre no Sisodonto pelo navegador do Admin antes de gerar relatórios.',409);
  const active=await db('amanda_report_jobs',{requested_by:'eq.'+actor.id,status:'in.(queued,running)',select:'id',limit:1});assert(!active.length,'Você já tem um relatório na fila. Aguarde a conclusão.',409);
  const rows=await db('amanda_report_jobs',{},'POST',{requested_by:actor.id,kind:input.kind,status:'queued',payload:{date:input.date,period:input.period,manager,progress:0,message:'Na fila para leitura do Sisodonto.'}});return jobPublic(rows[0]);
 }
 if(action==='browser_job_list'){const rows=await db('amanda_report_jobs',{...(!input.all||!actor.roles.includes('developer')?{requested_by:'eq.'+actor.id}:{}),select:'*',order:'created_at.desc',limit:30});return rows.map(jobPublic)}
 throw Error('Unknown browser operation');
}
