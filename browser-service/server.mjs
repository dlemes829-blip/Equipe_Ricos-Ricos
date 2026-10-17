import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import readExcelFile from 'read-excel-file/node';
import {authorized,safeNetworkUrl,expand,allowedKeys} from './security.mjs';
import {csvRows} from './core.mjs';
const secret=process.env.BROWSER_AGENT_SECRET,callback=process.env.APP_CALLBACK_ORIGIN;
if(!/^[a-f0-9]{64}$/.test(secret||'')||!callback?.startsWith('https://'))throw Error('Private browser environment is not configured');
const viewport={width:1280,height:800};let browser,context,page,booting,config={allowedOrigins:[],flows:{}},owner=null,lease=0,busy=false,pumping=false,loading=false,dialog=null,closed=false,lastSave=0,lastSavedAt=null,persistTimer,commandQueue=Promise.resolve();
async function app(path,body,timeout=90000){const response=await fetch(callback+'/internal/browser/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Amanda-Agent':secret},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeout)});if(!response.ok)throw Error('Não foi possível acessar a sessão ou os relatórios.');return response.json()}
async function saveProfile(force=false){if(!context||!force&&Date.now()-lastSave<12000)return;lastSave=Date.now();const storage=await context.storageState({indexedDB:true}),sessionStorage={};for(const p of context.pages()){try{const u=new URL(p.url());if(config.allowedOrigins.includes(u.origin))sessionStorage[u.origin]=await p.evaluate(()=>Object.fromEntries(Object.entries(window.sessionStorage)))}catch{}}
 await app('profile',{profile:{storage,sessionStorage,openUrls:context.pages().map(p=>p.url()).filter(url=>{try{return config.allowedOrigins.includes(new URL(url).origin)}catch{return false}}).slice(0,4)}});lastSavedAt=new Date().toISOString()}
function attach(p){p.on('dialog',d=>{dialog=d});p.on('close',()=>{if(page===p){page=context.pages().find(p=>!p.isClosed())||null}if(dialog)dialog=null});p.on('framenavigated',()=>{clearTimeout(persistTimer);persistTimer=setTimeout(()=>saveProfile().catch(()=>{}),5000)})}
async function start(){if(context)return;if(booting)return booting;booting=(async()=>{
 const state=await app('state');config=state.config||{allowedOrigins:[],flows:{}};
 browser=await chromium.launch({headless:true,chromiumSandbox:false,args:['--disable-dev-shm-usage','--disable-extensions','--disable-background-networking','--disable-sync','--no-first-run','--disable-features=MediaRouter','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});browser.on('disconnected',()=>{browser=null;context=null;page=null;booting=null});
 context=await browser.newContext({viewport,locale:'pt-BR',timezoneId:'America/Sao_Paulo',acceptDownloads:true,serviceWorkers:'block',...(state.profile?.storage?{storageState:state.profile.storage}:{}),permissions:[]});
 if(state.profile?.sessionStorage)await context.addInitScript(s=>{const values=s[location.origin];if(values)for(const[k,v]of Object.entries(values))sessionStorage.setItem(k,v)},state.profile.sessionStorage);
 await context.route('**/*',async route=>{try{const req=route.request(),u=await safeNetworkUrl(req.url());if(req.isNavigationRequest()&&req.frame().parentFrame()===null&&!config.allowedOrigins.includes(u.origin))throw Error('Origem não permitida');await route.continue()}catch{await route.abort('blockedbyclient')}});
 await context.routeWebSocket('**',async ws=>{try{await safeNetworkUrl(ws.url());ws.connectToServer()}catch{ws.close()}});
 context.on('page',p=>{attach(p);if(!busy)page=p});page=await context.newPage();
 const initial=state.profile?.openUrls?.find(url=>{try{return config.allowedOrigins.includes(new URL(url).origin)}catch{return false}})||config.homepage;
 if(initial){await navigate(initial).catch(()=>{})}else await page.setContent('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="margin:0;background:#242831;color:#e7edf6;font:18px system-ui;display:grid;place-items:center;height:100vh"><main style="max-width:680px;padding:50px"><div style="font-size:13px;color:#9db5d4;letter-spacing:3px">GESTÃO EQUIPE AMANDA</div><h1>Seu Chromium está pronto.</h1><p>Informe a URL do Sisodonto na barra acima para começar.</p><p style="font-size:14px;color:#b2bfd0">O acesso interativo fica restrito ao desenvolvimento. Os demais usuários solicitam relatórios pelas abas comuns.</p><input aria-label="Teste de digitação" placeholder="Você pode testar a digitação aqui" style="width:100%;padding:15px;background:#343e4e;border:1px solid #788da8;color:white;font:16px system-ui"></main></body></html>');
 })();try{await booting}finally{booting=null}}
async function navigate(url){const u=await safeNetworkUrl(url);if(!config.allowedOrigins.includes(u.origin))throw Object.assign(Error('Adicione esta origem à configuração do Sisodonto antes de navegar.'),{status:400});loading=true;try{await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:60000})}finally{loading=false}}
function claim(actor){if(busy)throw Object.assign(Error('Um relatório está em execução. Aguarde a conclusão.'),{status:409});if(owner&&owner!==actor&&lease>Date.now())throw Object.assign(Error('Outro desenvolvedor está usando o navegador.'),{status:409});owner=actor;lease=Date.now()+20000}
async function metadata(){return {ready:!!page,busy,loading,viewport,url:page?.url()||'',title:page?await page.title().catch(()=>''):'',tabs:context?await Promise.all(context.pages().filter(p=>!p.isClosed()).map(async(p,index)=>({index,title:await p.title().catch(()=>''),active:p===page}))):[],dialog:dialog?{type:dialog.type(),message:dialog.message().slice(0,300)}:null,lastSavedAt}}
async function control(b){
 if(typeof b.actor!=='string'||b.actor.length>80)throw Object.assign(Error('Acesso não autorizado.'),{status:403});
 if(b.action==='release'){if(owner&&owner!==b.actor)throw Object.assign(Error('Navegador ocupado.'),{status:409});if(context)await saveProfile(true);lease=0;owner=null;void pump();return metadata()}
 claim(b.actor);await start();if(b.action==='open'){const state=await app('state');config=state.config;return metadata()}
 if(b.action==='goto'){const state=await app('state');config=state.config;await navigate(b.url)}
 else if(b.action==='back')await page.goBack({waitUntil:'domcontentloaded',timeout:30000});
 else if(b.action==='forward')await page.goForward({waitUntil:'domcontentloaded',timeout:30000});
 else if(b.action==='reload')await page.reload({waitUntil:'domcontentloaded',timeout:40000});
 else if(b.action==='click'){const x=Number(b.x),y=Number(b.y);if(!(x>=0&&x<1280&&y>=0&&y<800))throw Object.assign(Error('Coordenadas inválidas.'),{status:400});await page.mouse.click(x,y,{clickCount:b.double?2:1,button:b.button==='right'?'right':'left'})}
 else if(b.action==='text'){if(typeof b.text!=='string'||b.text.length>4000)throw Object.assign(Error('Texto excede o limite.'),{status:400});await page.keyboard.insertText(b.text)}
 else if(b.action==='copy')return {...await metadata(),selection:await page.evaluate(()=>window.getSelection()?.toString().slice(0,100000)||'')};
 else if(b.action==='key'){if(!allowedKeys.has(b.key))throw Object.assign(Error('Tecla não permitida.'),{status:400});await page.keyboard.press(b.key)}
 else if(b.action==='wheel')await page.mouse.wheel(Math.max(-2000,Math.min(2000,Number(b.x)||0)),Math.max(-2000,Math.min(2000,Number(b.y)||0)));
 else if(b.action==='new-tab'){if(context.pages().length>=4)throw Object.assign(Error('Limite de quatro abas.'),{status:409});page=await context.newPage();if(config.homepage)await navigate(config.homepage);else await page.setContent('<body style="background:#242831;color:white;font:20px system-ui;padding:50px">Nova aba. Informe a URL do Sisodonto acima.</body>')}
 else if(b.action==='switch-tab'){const p=context.pages()[Number(b.index)];if(!p)throw Error('Aba não encontrada.');page=p}
 else if(b.action==='close-tab'){if(context.pages().length<=1)throw Object.assign(Error('Mantenha pelo menos uma aba aberta.'),{status:400});await page.close()}
 else if(b.action==='dialog'){if(dialog){const current=dialog;dialog=null;if(b.accept)await current.accept(String(b.text||''));else await current.dismiss()}}
 else if(b.action==='save')await saveProfile(true);
 else if(b.action==='reset'){await context.clearCookies();await context.clearPermissions();for(const p of context.pages())await p.close();await context.close();context=null;await browser.close();browser=null;await app('profile',{profile:{storage:{cookies:[],origins:[]},sessionStorage:{},openUrls:[]}});await start()}
 clearTimeout(persistTimer);persistTimer=setTimeout(()=>saveProfile().catch(()=>{}),2500);return metadata();
}
function target(step){const frame=step.frame?page.frameLocator(step.frame):page;return frame.locator(step.selector).first()}
async function run(job,flow){const vars={date:job.payload.date,monthStart:job.payload.date.slice(0,7)+'-01',monthEnd:new Date(Date.UTC(Number(job.payload.date.slice(0,4)),Number(job.payload.date.slice(5,7)),0)).toISOString().slice(0,10),manager:job.payload.manager};let downloadData;
 for(let index=0;index<flow.steps.length;index++){
  if(Date.now()-Date.parse(job.updated_at)>8*60000)throw Error('Tempo de execução excedido.');const step=flow.steps[index];await app('progress',{id:job.id,run:job.payload.run,progress:Math.round((index+1)/(flow.steps.length+1)*90),step:index+1});
  if(step.action==='goto')await navigate(new URL(expand(step.value,vars),config.homepage).href);
  else if(step.action==='click')await target(step).click({timeout:40000});
  else if(step.action==='fill'){const locator=target(step),type=await locator.getAttribute('type');if(type==='password')throw Error('As rotas não podem preencher senhas.');await locator.fill(expand(step.value,vars),{timeout:30000})}
  else if(step.action==='select')await target(step).selectOption(expand(step.value,vars),{timeout:30000});
  else if(step.action==='wait')await target(step).waitFor({state:'visible',timeout:60000});
  else if(step.action==='download'){
   const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),target(step).click({timeout:30000})]);const path=await download.path(),stat=await fs.stat(path);if(stat.size>15000000)throw Error('Relatório excede 15 MB.');const bytes=await fs.readFile(path),name=download.suggestedFilename();if(/\.csv$/i.test(name))downloadData={tables:[csvRows(new TextDecoder('utf-8').decode(bytes))]};else if(/\.xlsx$/i.test(name)){const sheets=await readExcelFile(bytes);downloadData={tables:sheets.map(s=>s.data)}}else throw Error('Use um relatório XLSX ou CSV.');await download.delete();
  }
 }
 if(downloadData)return downloadData;const extraction=flow.extraction||{},frame=extraction.frame?page.frameLocator(extraction.frame):page;
 if(extraction.type==='download')throw Error('Configure um passo de download.');
 if(extraction.type==='text')return {text:(await frame.locator(extraction.selector||'body').innerText({timeout:60000})).slice(0,3500000)};
 await frame.locator(extraction.selector||'table').first().waitFor({state:'visible',timeout:60000});const tables=await frame.locator(extraction.selector||'table').evaluateAll(elements=>elements.map(t=>Array.from(t.querySelectorAll('tr')).map(r=>Array.from(r.querySelectorAll('th,td')).map(c=>c.innerText.trim()))));return {tables};
}
async function pump(){if(pumping||closed)return;pumping=true;try{
 if(lease>Date.now()||busy)return;const claimed=await app('claim',{});if(!claimed.job)return;busy=true;const job=claimed.job;
 try{await start();config=claimed.config||config;const flow=config.flows?.[job.kind];if(!flow?.enabled)throw Error('Caminho desativado.');if(!page)page=await context.newPage();const result=await run(job,flow);await saveProfile(true);await app('finish',{id:job.id,run:job.payload.run,result},90000)}catch(error){await app('finish',{id:job.id,run:job.payload.run,failed:true,message:'Não foi possível ler o relatório. Confira o login, os filtros e os passos configurados no Admin.'}).catch(()=>{})}finally{busy=false}
 }catch{console.error('Browser job or private callback unavailable')}finally{pumping=false}}
const server=http.createServer(async(req,res)=>{const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};try{
 const path=new URL(req.url,'http://localhost').pathname;if(path==='/health'&&req.method==='GET')return send(200,{ok:true});if(!authorized(req.headers['x-amanda-agent'],secret))return send(401,{error:'Unauthorized'});
 if(path==='/status'&&req.method==='GET')return send(200,await metadata());
 if(path==='/frame'&&req.method==='GET'){if(!page)return send(409,{error:'Inicie o navegador.'});if(owner&&lease>Date.now())lease=Date.now()+20000;const bytes=await page.screenshot({type:'jpeg',quality:65,timeout:8000,animations:'disabled'});res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes)}
 if(req.method!=='POST')return send(404,{error:'Not found'});let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>20000)return send(413,{error:'Payload too large'});chunks.push(c)}let b;try{b=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{return send(400,{error:'Invalid JSON'})}
 if(path==='/wake'){void pump();return send(202,{ok:true})}
 if(path==='/control'){const work=commandQueue.then(()=>control(b));commandQueue=work.catch(()=>{});return send(200,await work)}
 return send(404,{error:'Not found'});
 }catch(error){send(error.status||503,{error:error.status?error.message:'Não foi possível concluir a operação no navegador. Tente novamente.'})}});
server.listen(Number(process.env.PORT||10000),'0.0.0.0');setInterval(()=>{if(!pumping&&!busy)void pump()},7000).unref();setInterval(()=>{if(context&&!busy)void saveProfile().catch(()=>{})},30000).unref();
process.on('SIGTERM',async()=>{closed=true;try{await saveProfile(true)}catch{}await browser?.close().catch(()=>{});server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),15000).unref()});
