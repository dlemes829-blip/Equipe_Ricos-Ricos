export async function storage(method='GET',body,version,path='',sessionHash){
 const response=await fetch(process.env.SUPABASE_EDGE_URL+path,{method,headers:{'Content-Type':'application/json','X-Amanda-Bridge':process.env.SUPABASE_BRIDGE_TOKEN,'Authorization':'Bearer '+process.env.SUPABASE_ANON_KEY,'X-Amanda-Data-Key':process.env.APP_DATA_ENCRYPTION_KEY,...(sessionHash?{'X-Amanda-Session':sessionHash}:{}),...(version?{'If-Match':version}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 let data;try{data=await response.json()}catch{data={error:'Armazenamento indisponível.'}}
 if(!response.ok){const e=new Error(response.status===409?'Outra pessoa atualizou os dados ou este usuário já existe. Recarregue antes de salvar.':response.status<500?data.error||'Acesso não autorizado.':'Não foi possível acessar os dados.');e.status=response.status<500?response.status:503;throw e}
 return {data,version:response.headers.get('X-State-Version')||response.headers.get('ETag')};
}
export const operation=async(action,input={})=>(await storage('POST',{action,input},null,'/ops')).data;
