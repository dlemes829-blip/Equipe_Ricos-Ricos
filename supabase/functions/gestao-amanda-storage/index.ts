import { operations, sessionUser } from "./ops.ts";
import { scopedState, mergeOwnedState } from "./access.mjs";
const EXPECTED_BRIDGE_SHA256="78d040a9a5efe242d0cb3f4dca7a01a77cd7164b2436a13a9eb493d90a0510b5";
const response=(status,data,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",...headers}});
Deno.serve(async(req)=>{
 try{
  const token=req.headers.get("X-Amanda-Bridge")||"";
  if(token.length!==64)return response(401,{error:"Unauthorized"});
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,"0")).join("");
  if(digest!==EXPECTED_BRIDGE_SHA256)return response(401,{error:"Unauthorized"});
  const modern=Deno.env.get("SUPABASE_SECRET_KEYS");
  const key=(modern?JSON.parse(modern).default:null)||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!key)return response(503,{error:"Storage unavailable"});
  const headers={"apikey":key,"Content-Type":"application/json",...(key.startsWith("ey")?{"Authorization":"Bearer "+key}:{})};
  const db=async(table,params={},method="GET",body)=>{
   const url=new URL(Deno.env.get("SUPABASE_URL")+"/rest/v1/"+table);
   for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
   const res=await fetch(url,{method:method==="UPSERT"?"POST":method,headers:{...headers,"Prefer":method==="UPSERT"?"return=representation,resolution=merge-duplicates":"return=representation"},...(body?{body:JSON.stringify(body)}:{})});
   if(!res.ok){const e=new Error(res.status===409?"Este nome de usuário já está em uso.":"Falha no armazenamento.");e.status=res.status===409?409:503;throw e}
   return res.status===204?[]:await res.json();
  };
  if(new URL(req.url).pathname.endsWith("/ops")){
   if(req.method!=="POST")return response(405,{error:"Method not allowed"});
   const text=await req.text();if(text.length>6000000)return response(413,{error:"Payload too large"});
   let b;try{b=JSON.parse(text)}catch{return response(400,{error:"Invalid JSON"})}
   return response(200,await operations(b.action,b.input||{},db));
  }
  const user=await sessionUser(req.headers.get("X-Amanda-Session"),db);
  const rows=await db("gestao_amanda_state",{id:"eq.1",select:"version,payload",limit:1});
  if(!rows.length)return response(503,{error:"Storage not initialized"});
  if(req.method==="GET")return response(200,scopedState(rows[0].payload,user),{"X-State-Version":rows[0].version});
  if(req.method!=="PUT")return response(405,{error:"Method not allowed"});
  const version=(req.headers.get("If-Match")||"").replace(/^W\//,"").replace(/^"|"$/g,"");
  if(version!==rows[0].version)return response(409,{error:"Outra pessoa atualizou os dados. Recarregue antes de salvar."});
  const text=await req.text();if(text.length>6000000)return response(413,{error:"Payload too large"});
  let data;try{data=JSON.parse(text)}catch{return response(400,{error:"Invalid JSON"})}
  const {overview,...incoming}=data;
  const merged=mergeOwnedState(rows[0].payload,incoming,user),next=crypto.randomUUID();
  const saved=await db("gestao_amanda_state",{id:"eq.1",version:"eq."+version,select:"version"},"PATCH",{version:next,payload:merged,updated_at:new Date().toISOString()});
  if(!saved.length)return response(409,{error:"Conflito de atualização."});
  return response(200,{ok:true},{"X-State-Version":next});
 }catch(error){return response(error.status||503,{error:error.status&&error.status<500?error.message:"Serviço temporariamente indisponível."})}
});
