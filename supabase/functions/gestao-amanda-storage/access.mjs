export const MANAGERS=['AMANDA VITORIA KRUTSCH','DANIEL LEMES CARVALHO','EDUARDA APIM SANTOS','FELIPE GOMES DE PONTES','JOAO HENRIQUE SOTOSKI NAZARKO','MILENA MARTINS'];
export const isDev=user=>Boolean(user?.roles?.includes('developer'));
export const isSupervisor=user=>Boolean(user?.roles?.includes('supervisor'));
export const isPrivileged=user=>isDev(user)||isSupervisor(user);
export const publicUser=user=>{if(!user)return null;const {id,username,name,status,roles,manager,is_pro,last_seen_at}=user;return {id,username,name,status,roles,manager,is_pro,last_seen_at}};
export function validUsername(username){return typeof username==='string'&&/^[a-z0-9_.-]{3,40}$/.test(username)}
export function assert(condition,message,status=400){if(!condition){let error=new Error(message);error.status=status;throw error}}
export function requireDev(user){assert(isDev(user),'Acesso exclusivo do desenvolvimento.',403)}
export function requireSupervisor(user){assert(isPrivileged(user),'Acesso exclusivo da supervisão ou desenvolvimento.',403)}
export function validateState(s){
 assert(s&&typeof s==='object','Dados inválidos.');
 for(let key of ['units','chairs','evals','goals','history','merit','meritTargets','daily'])assert(Array.isArray(s[key])&&s[key].length<20000,'Formato inválido: '+key);
 if(s.evaluationSummaries!==undefined)assert(Array.isArray(s.evaluationSummaries)&&s.evaluationSummaries.length<20000,'Resumos inválidos.');
 const numbers=(r,keys,integer=false)=>keys.every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])&&r[k]>=0&&(!integer||Number.isInteger(r[k])));
 assert(s.units.every(u=>typeof u.id==='string'&&MANAGERS.includes(u.manager)&&typeof u.name==='string'&&numbers(u,['actual','chairs','target'])),'Unidades inválidas.');
 const date=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d));
 if(s.evaluationSummaries)assert(s.evaluationSummaries.every(r=>MANAGERS.includes(r.manager)&&date(r.date)&&['Antes das 18h','Depois das 18h'].includes(r.period)&&numbers(r,['attended','cancelled','absent','scheduled','total'],true)&&r.total===r.attended+r.cancelled+r.absent+r.scheduled),'Resumos de avaliações inválidos.');
 assert(s.chairs.every(r=>typeof r.id==='string'&&date(r.date)&&numbers(r,['actual','chairs','target'])),'Relatório de cadeiras inválido.');
 assert(s.evals.every(r=>typeof r.id==='string'&&date(r.date)&&['Antes das 18h','Depois das 18h'].includes(r.period)&&numbers(r,['attended','cancelled','absent','scheduled','total'],true)&&r.total===r.attended+r.cancelled+r.absent+r.scheduled),'Avaliações inválidas.');
 assert(s.merit.every(r=>typeof r.id==='string'&&MANAGERS.includes(r.manager)&&/^\d{4}-\d{2}$/.test(r.month)&&numbers(r,['base','revenue','paid','bonus','recordCash','days'])),'Mérito inválido.');
 assert(s.daily.every(r=>MANAGERS.includes(r.manager)&&date(r.today)&&date(r.yesterday)&&numbers(r,['cgTarget','cgActual','orthoTarget','orthoActual','todayCg','todayOrtho','evalTotal','evalRequired'])),'Fechamento inválido.');
 assert(s.goals.every(r=>typeof r.unit==='string'&&typeof r.metric==='string'&&r.metric.length<100&&['dia','mes'].includes(r.period)&&typeof r.date==='string'&&numbers(r,['target','actual'])),'Metas inválidas.');
 assert(s.meritTargets.every(r=>MANAGERS.includes(r.manager)&&numbers(r,['gain1Offset','gain2Offset'])),'Objetivos de mérito inválidos.');
}
function reconciledSummaries(full,incoming){
 const before=new Map(),after=new Map(),owners=new Map(full.units.map(u=>[u.id,u.manager]));
 const collect=(map,rows)=>{for(const r of rows){const k=(owners.get(r.id)||r.manager)+':'+r.date+':'+r.period;if(!map.has(k))map.set(k,[]);map.get(k).push([r.id,r.attended,r.cancelled,r.absent,r.scheduled,r.total])}for(const[k,v]of map)map.set(k,JSON.stringify(v.sort((a,b)=>String(a[0]).localeCompare(String(b[0])))))};
 collect(before,full.evals);collect(after,incoming.evals);
 return (full.evaluationSummaries||[]).filter(r=>before.get(r.manager+':'+r.date+':'+r.period)===after.get(r.manager+':'+r.date+':'+r.period));
}
export function mergeOwnedState(full,incoming,user){
 validateState(incoming);if(isPrivileged(user))return {...incoming,evaluationSummaries:reconciledSummaries(full,incoming)};
 assert(MANAGERS.includes(user.manager),'Sua carteira ainda não foi atribuída.',403);
 const ids=new Set(full.units.filter(u=>u.manager===user.manager).map(u=>u.id));
 assert(incoming.units.every(u=>ids.has(u.id)&&u.manager===user.manager),'Não é permitido alterar outra carteira.',403);
 for(const key of ['chairs','evals'])assert(incoming[key].every(r=>ids.has(r.id)),'Registro de outra carteira.',403);
 for(const key of ['merit','meritTargets','daily'])assert(incoming[key].every(r=>r.manager===user.manager),'Registro de outro gerente.',403);
 const ownsGoal=r=>r.unit==='manager:'+user.manager||ids.has(r.unit);
 assert(incoming.goals.every(ownsGoal),'Meta de outro responsável.',403);
 const result={...full};
 // Assignment, unit identity and baseline remain managed by supervision.
 result.units=full.units;
 for(const key of ['chairs','evals'])result[key]=full[key].filter(r=>!ids.has(r.id)).concat(incoming[key]);
 for(const key of ['merit','meritTargets','daily'])result[key]=full[key].filter(r=>r.manager!==user.manager).concat(incoming[key]);
 result.goals=full.goals.filter(r=>!ownsGoal(r)).concat(incoming.goals);
 result.history=full.history.filter(r=>r.createdBy!==user.id).concat(incoming.history.map(r=>({created:String(r.created||'').slice(0,100),kind:String(r.kind||'').slice(0,150),date:String(r.date||'').slice(0,10),count:Number(r.count)||0,createdBy:user.id,manager:user.manager})));
 result.evaluationSummaries=reconciledSummaries(full,result);
 return result;
}
export function teamOverview(state){
 const units=new Map(state.units.map(u=>[u.id,u])),latestUnits=new Map(),byManager=new Map(),rank=p=>p==='Depois das 18h'?2:1;
 for(const r of state.evals){const k=r.id+':'+r.date,old=latestUnits.get(k);if(!old||rank(r.period)>=rank(old.period))latestUnits.set(k,r)}
 for(const r of latestUnits.values()){const manager=units.get(r.id)?.manager;if(!manager)continue;const key=manager+':'+r.date;let a=byManager.get(key)||{manager,date:r.date,period:r.period,attended:0,cancelled:0,absent:0,scheduled:0,total:0,clinics:0,source:'units'};for(const k of ['attended','cancelled','absent','scheduled','total'])a[k]+=r[k];a.clinics++;if(rank(r.period)>rank(a.period))a.period=r.period;byManager.set(key,a)}
 const summaries=new Map();for(const r of state.evaluationSummaries||[]){const k=r.manager+':'+r.date,old=summaries.get(k);if(!old||rank(r.period)>=rank(old.period))summaries.set(k,r)}
 for(const [key,r]of summaries){const detail=byManager.get(key);if(!detail||rank(r.period)>=rank(detail.period))byManager.set(key,{...r,clinics:r.unitCount||0,source:r.detailStatus==='summary_only'?'manager_summary':'verified_report'})}
 return {goals:state.goals.filter(g=>g.unit.startsWith('manager:')),daily:state.daily,evaluations:[...byManager.values()],units:MANAGERS.map(manager=>({manager,count:state.units.filter(u=>u.manager===manager).length}))};
}
export function scopedState(state,user){const overview=teamOverview(state);if(isPrivileged(user))return {...state,overview};const ids=new Set(state.units.filter(u=>u.manager===user.manager).map(u=>u.id));return {...state,evaluationSummaries:(state.evaluationSummaries||[]).filter(r=>r.manager===user.manager),units:state.units.filter(u=>ids.has(u.id)),chairs:state.chairs.filter(r=>ids.has(r.id)),evals:state.evals.filter(r=>ids.has(r.id)),goals:state.goals.filter(r=>r.unit==='manager:'+user.manager||ids.has(r.unit)),history:state.history.filter(r=>r.createdBy===user.id),merit:state.merit.filter(r=>r.manager===user.manager),meritTargets:state.meritTargets.filter(r=>r.manager===user.manager),daily:state.daily.filter(r=>r.manager===user.manager),overview}}
