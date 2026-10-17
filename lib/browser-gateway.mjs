import crypto from 'node:crypto';
export function agentAuthenticated(value){const expected=process.env.BROWSER_AGENT_SECRET||'';if(!/^[a-f0-9]{64}$/.test(expected)||typeof value!=='string'||value.length!==expected.length)return false;return crypto.timingSafeEqual(Buffer.from(value),Buffer.from(expected))}
export async function browserRequest(path,body,timeout=90000,raw=false){
 if(!process.env.BROWSER_AGENT_URL||!process.env.BROWSER_AGENT_SECRET){const e=Error('Navegador ainda não conectado ao servidor.');e.status=503;throw e}
 const response=await fetch(process.env.BROWSER_AGENT_URL+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Amanda-Agent':process.env.BROWSER_AGENT_SECRET},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});
 if(!response.ok){let data;try{data=await response.json()}catch{}const e=Error(data?.error||'Não foi possível acessar o navegador. Tente novamente.');e.status=[400,403,409,429].includes(response.status)?response.status:503;throw e}return raw?response:response.json();
}
export async function wakeBrowser(){try{await browserRequest('/wake',{},1200)}catch{}}
