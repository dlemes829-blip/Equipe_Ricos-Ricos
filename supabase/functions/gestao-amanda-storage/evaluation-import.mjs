import {parseEvaluations} from './evaluations.mjs';
import {assert,isPrivileged,MANAGERS} from './access.mjs';
const fields=['attended','cancelled','absent','scheduled','total'];
const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function evaluationOperation(action,input,actor,db){
 const date=input.date,period=input.period;
 assert(/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&!Number.isNaN(Date.parse(date)),'Data inválida.');assert(['Antes das 18h','Depois das 18h'].includes(period),'Retrato inválido.');
 const scope=isPrivileged(actor)?input.manager?[input.manager]:MANAGERS:[actor.manager];assert(scope.every(m=>MANAGERS.includes(m)),'Carteira inválida.');
 assert(typeof input.text==='string'&&input.text.trim()&&input.text.length<3000000,'Cole um relatório de até 3 MB.');assert(!input.corrections||typeof input.corrections==='object'&&JSON.stringify(input.corrections).length<300000,'Correções inválidas.');
 for(let attempt=0;attempt<4;attempt++){
  const stored=(await db('gestao_amanda_state',{id:'eq.1',select:'version,payload',limit:1}))[0];assert(stored,'Dados indisponíveis.',503);
  const s=stored.payload,units=s.units.filter(u=>scope.includes(u.manager));let parsed;try{parsed=parseEvaluations(input.text,units,{allowedManagers:scope,corrections:input.corrections||{},showUnknown:isPrivileged(actor)})}catch(e){assert(false,e.message)}
  const signature=await sha({date,period,rows:parsed.rows,summaries:parsed.summaries,groups:parsed.groups.map(g=>({manager:g.manager,status:g.status,units:g.units,issues:g.issues})),registry:units.map(u=>[u.id,u.name,u.manager])});
  if(action==='evaluation_preview')return {...parsed,signature,date,period,scope};
  assert(action==='evaluation_import','Operação inválida.');assert(signature===input.signature,'O relatório ou o cadastro mudou. Confira a prévia novamente.',409);
  assert(!parsed.groups.some(g=>['pending','blocked'].includes(g.status))||input.onlyReady===true,'Há gerentes com campos pendentes ou divergências. Corrija a prévia antes de salvar.',409);
  assert(parsed.rows.length||parsed.summaries.length,'Nenhum dado conferido para importar.');
  const importedAt=new Date().toISOString(),importId=crypto.randomUUID();
  const rows=parsed.rows.map(r=>({...Object.fromEntries(['id','name','manager',...fields].map(k=>[k,r[k]])),date,period,source:'Relatório conferido',importId,capturedAt:importedAt,...(r.totalCalculated?{totalCalculated:true}:{})}));
  const summaries=parsed.summaries.map(r=>({...r,date,period,source:'Relatório conferido',importId,capturedAt:importedAt}));
  const affected=new Set(parsed.groups.filter(g=>['verified','summary_only'].includes(g.status)).map(g=>g.manager));
  const payload={...s,evals:s.evals.filter(r=>!rows.some(n=>n.id===r.id&&n.date===r.date&&n.period===r.period)).concat(rows),evaluationSummaries:(s.evaluationSummaries||[]).filter(r=>!(affected.has(r.manager)&&r.date===date&&r.period===period)).concat(summaries),history:s.history.concat({created:importedAt,createdBy:actor.id,manager:scope.length===1?scope[0]:null,kind:'Avaliações conferidas',date,count:rows.length,summaryCount:summaries.length,sourceHash:await sha(input.text)}).slice(-10000)};
  const saved=await db('gestao_amanda_state',{id:'eq.1',version:'eq.'+stored.version,select:'version'},'PATCH',{payload,version:crypto.randomUUID(),updated_at:importedAt});
  if(saved.length)return {ok:true,units:rows.length,managers:affected.size,summaryOnly:parsed.stats.summaryOnly,total:parsed.stats.total,importId};
 }
 assert(false,'Os dados foram atualizados por outra pessoa. Confira a prévia novamente.',409);
}
