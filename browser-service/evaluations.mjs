// Deterministic report reader. No HTML execution, fuzzy identity match, or guessed counts.
export const evaluationManagers=[{id:'99674',name:'AMANDA VITORIA KRUTSCH'},{id:'100471',name:'DANIEL LEMES CARVALHO'},{id:'100892',name:'EDUARDA APIM SANTOS'},{id:'96012',name:'FELIPE GOMES DE PONTES'},{id:'99673',name:'JOAO HENRIQUE SOTOSKI NAZARKO'},{id:'97977',name:'MILENA MARTINS'}];
const fields=['attended','cancelled','absent','scheduled','total'];
const plain=s=>String(s??'').replace(/\*\*|`/g,'').replace(/\\([#|_*])/g,'$1').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\u00a0/g,' ').trim();
const key=s=>plain(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const nameKey=s=>key(plain(s).replace(/\[F?\s*\d+\]/gi,''));
const aliases={id:['#','ID','CODIGO','COD','COD FRANQUIA','ID FRANQUIA','ID UNIDADE'],name:['FRANQUIA','UNIDADE','CLINICA','NOME','GERENTE','RESPONSAVEL'],attended:['ATENDIDAS','ATENDIDOS','ATENDIDA','ATENDIDO'],cancelled:['CANCELADAS','CANCELADOS','CANCELADA','CANCELADO'],absent:['FALTOSOS','FALTOSAS','FALTAS'],scheduled:['AGENDADAS NO DIA','AGENDADOS NO DIA','AGENDADAS','AGENDADOS','AGENDAMENTOS DO DIA'],total:['TOTAL AVALIACOES','TOTAL DE AVALIACOES','TOTAL','AVALIACOES']};
function headerField(s){const k=key(s);for(const [field,words]of Object.entries(aliases))if(words.some(w=>key(w)===k))return field;return null}
const footer=s=>/MOSTRANDO\s+DE|PESQUISAR|PAGINA\s+\d|REGISTROS\s+POR\s+PAGINA/i.test(key(s));
const count=value=>{if(value===undefined||value===null||plain(value)==='')return null;if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0&&value<=10000000?value:NaN;const s=plain(value);if(!/^\d+$/.test(s)&&!/^\d{1,3}(\.\d{3})+$/.test(s))return NaN;const n=Number(s.replace(/\./g,''));return Number.isSafeInteger(n)&&n<=10000000?n:NaN};
const htmlText=s=>plain(String(s).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,entity=>{const fixed={'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};if(fixed[entity.toLowerCase()])return fixed[entity.toLowerCase()];try{return String.fromCodePoint(parseInt(entity.replace(/^&#x?/i,''),/^&#x/i.test(entity)?16:10))}catch{return ' '}}));
function splitLine(line,delimiter){let out=[],cell='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===delimiter&&!quoted){out.push(plain(cell));cell=''}else cell+=c}out.push(plain(cell));return out}
function normalizeInput(input){
 if(Array.isArray(input))return {format:'tabela / JSON',items:input.map((row,i)=>({row,line:i+1}))};
 if(input&&typeof input==='object'){if(Array.isArray(input.tables))return {format:'tabelas',items:input.tables.flatMap(table=>table.map(row=>({row}))) };const rows=input.rows||input.data||input.registros;if(Array.isArray(rows))return normalizeInput(rows);throw Error('JSON sem uma lista de registros.')}
 let text=String(input||'');if(text.length>3000000)throw Error('Limite de texto: 3 MB.');text=text.replace(/\r\n?/g,'\n').replace(/\\n/g,'\n').replace(/\\(?=\n|$)/g,'').replace(/^\s*\\\s*$/gm,'').replace(/\\([#|_*])/g,'$1');
 if(/^\s*[\[{]/.test(text)){try{return normalizeInput(JSON.parse(text))}catch(error){if(error.message==='JSON sem uma lista de registros.')throw error}}
 if(/<tr[\s>]/i.test(text)){const items=[...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map((m,i)=>({row:[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(c=>htmlText(c[1])),line:i+1}));return {format:'HTML',items}}
 const lines=text.split('\n');if(lines.length>30000)throw Error('Limite de 30 mil linhas por leitura.');let items=[],formats=new Set();
 for(let i=0;i<lines.length;i++){
  const line=plain(lines[i]);if(!line||/^\s*[:|\-\s]+$/.test(line))continue;
  if(footer(line)){items.push({footer:line,line:i+1});continue}
  let delimiter=line.includes('|')?'|':line.includes('\t')?'\t':line.includes(';')?';':line.includes(',')?',':null;
  if(delimiter){let row=splitLine(line,delimiter);if(delimiter==='|'){if(row[0]==='')row.shift();if(row.at(-1)==='')row.pop();formats.add('Markdown')}else formats.add(delimiter==='\t'?'tabulações':'CSV');items.push({row,line:i+1});continue}
  const compact=line.replace(/\s+/g,' '),singleId=/^\d+$/.test(compact);let next=i+1;while(next<lines.length&&!plain(lines[next]))next++;
  if(singleId&&next<lines.length&&/[A-Za-zÀ-ÿ]/.test(lines[next])&&!headerField(lines[next])&&!footer(lines[next])){
   const row=[compact];let j=next;while(j<lines.length&&plain(lines[j])&&!/^\d+(?:\.\d{3})*$/.test(plain(lines[j]))&&!footer(lines[j])&&!headerField(lines[j])){row.push(plain(lines[j]));j++}
   const name=row.slice(1).join(' '),values=[];while(j<lines.length&&values.length<5){const v=plain(lines[j]);if(!v){j++;continue}if(!/^\d+(?:\.\d{3})*$/.test(v))break;values.push(v);j++}
   items.push({row:[compact,name,...values],line:i+1,vertical:true});formats.add('linhas quebradas');i=j-1;continue;
  }
  if(headerField(line)){items.push({headerToken:line,line:i+1});continue}
  items.push({text:compact,line:i+1});formats.add('texto');
 }
 return {format:[...formats].join(' + ')||'texto',items};
}
function objectRow(value){const object={};for(const [k,v]of Object.entries(value))object[key(k)]=v;const find=arr=>{for(const label of arr)if(key(label)in object)return object[key(label)]};const clinic=find(['franquia','unidade','clinica']),manager=find(['gerente','responsavel']);const name=clinic??manager??find(['nome','name']);return {id:find(['#','id','codigo','cod']),name,declaredManager:clinic?manager:null,type:clinic?'unit':manager?'manager':null,values:Object.fromEntries(fields.map(f=>[f,find(aliases[f].concat(f))]))}}
function knownName(id,units,roster){return roster.find(r=>r.id===id)?.name||units.find(r=>r.id===id)?.name}
function textRow(text,units,roster){const match=text.match(/^(\d+)\s+(.+)$/);if(!match)return null;const id=match[1],tail=match[2].split(/\s+/),expected=knownName(id,units,roster);let fallback;
 for(let n=5;n>=3;n--){if(tail.length<=n)continue;const vals=tail.slice(-n);if(vals.some(v=>count(v)===null||Number.isNaN(count(v))))continue;const name=tail.slice(0,-n).join(' '),candidate={id,name,values:Object.fromEntries(fields.map((f,j)=>[f,vals[j]])),short:n<5};if(expected&&nameKey(name)===nameKey(expected))return candidate;if(!fallback)fallback=candidate}
 if(fallback)return fallback;return {id,name:match[2],values:{},incomplete:true};
}
export function parseEvaluations(input,units,options={}){
 const source=normalizeInput(input),roster=options.managers||evaluationManagers,allowed=new Set(options.allowedManagers||[...new Set(units.map(u=>u.manager))]),byId=new Map(units.map(u=>[String(u.id),u]));
 const issues=[],pending=[],groups=new Map(),seenUnits=new Map(),seenSummaries=new Map(),candidates=[];let header=null,context=null,lastType=null,foreign=0,duplicates=0,recordNo=0,managerSequence=0;
 const groupFor=manager=>{if(!groups.has(manager))groups.set(manager,{manager,id:roster.find(r=>r.name===manager)?.id||'',declared:null,records:[],issues:[],expectedUnits:null});return groups.get(manager)};
 const problem=(message,group,detail={})=>{issues.push(message);if(group)group.issues.push({message,...detail})};
 for(const item of source.items){
  if(item.footer){const m=item.footer.match(/de\s+(\d+)\s+registros/i);if(m&&context?.valid&&lastType==='unit'&&allowed.has(context.manager))groupFor(context.manager).expectedUnits=Number(m[1]);continue}
  if(item.headerToken){if(['GERENTE','RESPONSAVEL'].includes(key(item.headerToken)))lastType='manager';else if(['FRANQUIA','UNIDADE','CLINICA'].includes(key(item.headerToken)))lastType='unit';if(managerSequence>1)context=null;continue}
  let c;
  if(item.row){
   if(!Array.isArray(item.row)){if(typeof item.row==='object'&&item.row)c=objectRow(item.row);else continue}
   else{const cells=item.row.map(plain);if(!cells.some(Boolean))continue;const mapped=cells.map(headerField);if(mapped.filter(Boolean).length>=3&&mapped.includes('attended')){header={map:mapped,type:cells.some(v=>['GERENTE','RESPONSAVEL'].includes(key(v)))?'manager':'unit'};if(header.type==='unit'&&managerSequence>1)context=null;lastType=header.type;continue}if(cells.every(v=>!v||/^[:\-]+$/.test(v)))continue;
    if(header&&!item.vertical&&cells.length>=header.map.filter(Boolean).length-2){c={id:undefined,name:undefined,values:{},type:header.type};header.map.forEach((field,index)=>{if(field==='id'||field==='name')c[field]=cells[index];else if(field)c.values[field]=cells[index]})}
    else c={id:cells[0],name:cells[1],values:Object.fromEntries(fields.map((f,i)=>[f,cells[i+2]]))};
   }
  }else if(item.text)c=textRow(item.text,units,roster);
  if(!c||!c.name||footer(c.name))continue;recordNo++;if(recordNo>10000)throw Error('Limite de 10 mil registros por leitura.');c.name=plain(c.name);c.id=plain(c.id);const bracket=c.name.match(/\[F?\s*(\d+)\]/i);if(!c.id&&bracket)c.id=bracket[1];c.key=String(recordNo)+':'+c.id;c.line=item.line||recordNo;
  const overrides=options.corrections?.[c.key];if(overrides&&typeof overrides==='object')for(const f of fields)if(f in overrides)c.values[f]=overrides[f];
  const managerById=roster.find(r=>r.id===c.id),managerByName=roster.find(r=>nameKey(r.name)===nameKey(c.name)),managerCandidate=managerById||managerByName;
  if(managerCandidate){
   const manager=managerCandidate.name,valid=(!c.id||c.id===managerCandidate.id)&&nameKey(c.name)===nameKey(manager);context={manager,valid};managerSequence++;lastType='manager';if(!allowed.has(manager)){foreign++;continue}const g=groupFor(manager);
   if(!valid){problem('Gerente: código e nome não conferem com o cadastro.',g,{code:'manager_identity',line:c.line});continue}
   const values=Object.fromEntries(fields.map(f=>[f,count(c.values[f])]));if(fields.some(f=>values[f]===null||Number.isNaN(values[f]))||values.total!==values.attended+values.cancelled+values.absent+(values.scheduled||0)){pending.push({id:managerCandidate.id,name:manager,manager,...values,key:c.key,line:c.line,missing:fields.filter(f=>values[f]===null||Number.isNaN(values[f])),badTotal:true,totalCalculated:false,reportedName:c.name,type:'manager'});problem('Resumo de '+manager+': quantidades ausentes ou total inconsistente.',g,{code:'summary_counts',line:c.line});continue}
   const summary={...values,id:managerCandidate.id,manager,reportedName:c.name,line:c.line};const old=seenSummaries.get(manager);if(old){if(fields.some(f=>old[f]!==summary[f]))problem('Há resumos diferentes para '+manager+'.',g,{code:'summary_conflict'});else duplicates++}else{seenSummaries.set(manager,summary);g.declared=summary}continue;
  }
  if(managerSequence>1)context=null;let unit=c.id?byId.get(c.id):null;if(!c.id){const matches=units.filter(u=>nameKey(u.name)===nameKey(c.name));if(matches.length===1)unit=matches[0]}
  if(!unit){foreign++;if(context?.valid&&allowed.has(context.manager))problem('Há uma unidade não reconhecida no bloco de '+context.manager+'. Confira o código e o cadastro.',groupFor(context.manager),{code:'unknown_unit',line:c.line});if(options.showUnknown)problem('Unidade não reconhecida na carteira autorizada: '+(c.id||c.name),null);continue}
  if(!allowed.has(unit.manager)){foreign++;continue}const g=groupFor(unit.manager);lastType='unit';managerSequence=0;
  if(c.id&&bracket&&bracket[1]!==c.id||nameKey(c.name)!==nameKey(unit.name)){problem('Unidade #'+unit.id+': o nome informado não confere com '+unit.name+'.',g,{code:'unit_identity',line:c.line});continue}
  if(context&&(!context.valid||context.manager!==unit.manager)){problem('Unidade #'+unit.id+' pertence a '+unit.manager+', mas aparece no bloco de outro gerente.',g,{code:'unit_manager',line:c.line});continue}
  if(c.declaredManager&&nameKey(c.declaredManager)!==nameKey(unit.manager)){problem('Unidade #'+unit.id+': gerente informado diferente do cadastro.',g,{code:'unit_manager',line:c.line});continue}
  const values=Object.fromEntries(fields.map(f=>[f,count(c.values[f])]));const derived=values.total===null&&['attended','cancelled','absent'].every(f=>values[f]!==null&&!Number.isNaN(values[f]));if(derived)values.total=values.attended+values.cancelled+values.absent+(values.scheduled||0);
  const missing=fields.filter(f=>values[f]===null||Number.isNaN(values[f]));const badTotal=!missing.includes('total')&&['attended','cancelled','absent'].every(f=>!missing.includes(f))&&values.total!==values.attended+values.cancelled+values.absent+(values.scheduled||0);
  const record={id:unit.id,name:unit.name,manager:unit.manager,...values,key:c.key,line:c.line,totalCalculated:derived,missing,...(badTotal?{badTotal:true}:{}),reportedName:c.name};
  const prior=seenUnits.get(unit.id);if(prior){if(fields.some(f=>!Object.is(prior[f],record[f])))problem('Unidade #'+unit.id+' aparece com quantidades diferentes. Nenhuma das versões será importada.',g,{code:'duplicate_conflict'});else duplicates++;continue}seenUnits.set(unit.id,record);g.records.push(record);candidates.push(record);if(missing.length||badTotal)pending.push(record);
 }
 const rows=[],summaries=[],reportGroups=[];
 for(const g of groups.values()){
  const sum={attended:0,cancelled:0,absent:0,scheduled:0,total:0};for(const r of g.records)for(const f of fields)if(Number.isFinite(r[f]))sum[f]+=r[f];
  const incomplete=g.records.filter(r=>r.missing.length||r.badTotal),differences=[];
  if(g.expectedUnits!==null&&g.records.length!==g.expectedUnits)problem('O bloco de '+g.manager+' informa '+g.expectedUnits+' unidades, mas foram reconhecidas '+g.records.length+'.',g,{code:'unit_count'});
  if(g.declared&&g.records.length){for(const f of fields)if(!g.records.some(r=>r.missing.includes(f))&&sum[f]!==g.declared[f])differences.push({field:f,declared:g.declared[f],calculated:sum[f]});if(differences.length)problem('O subtotal de '+g.manager+' diverge da soma das unidades.',g,{code:'subtotal_mismatch',differences})}
  const status=g.issues.length?'blocked':incomplete.length?'pending':g.records.length?'verified':'summary_only';
  const safeRows=g.records.filter(r=>!r.missing.length&&!r.badTotal).map(({missing,badTotal,key,line,reportedName,...r})=>r);
  if(status==='verified'||status==='summary_only'){
   rows.push(...safeRows);
   const values=g.declared?Object.fromEntries(fields.map(f=>[f,g.declared[f]])):sum;
   if(g.declared)summaries.push({...values,manager:g.manager,id:g.id,detailStatus:status==='verified'?'verified':'summary_only',unitCount:safeRows.length});
  }
  reportGroups.push({manager:g.manager,id:g.id,status,declared:g.declared?Object.fromEntries(fields.map(f=>[f,g.declared[f]])):null,calculated:g.records.length?sum:null,units:g.records.map(r=>r.id),recognizedUnits:g.records.length,expectedUnits:g.expectedUnits,pending:incomplete.length,issues:g.issues,differences});
 }
 const readyGroups=reportGroups.filter(g=>['verified','summary_only'].includes(g.status));const stats={units:rows.length,managers:readyGroups.length,summaryOnly:readyGroups.filter(g=>g.status==='summary_only').length,pending:pending.length,blockedGroups:reportGroups.filter(g=>g.status==='blocked').length,foreign,duplicates,derivedTotals:candidates.filter(r=>r.totalCalculated).length,total:readyGroups.reduce((n,g)=>n+(g.declared?.total??g.calculated?.total??0),0)};
 return {rows,summaries,groups:reportGroups,pending,candidates,issues,format:source.format,stats};
}
