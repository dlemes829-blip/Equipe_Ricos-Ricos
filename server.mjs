import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL}):null;
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url)));
const html=fs.readFileSync(new URL('./page.html',import.meta.url));
if(pool){await pool.query('CREATE TABLE IF NOT EXISTS ricos_state (id integer PRIMARY KEY, version text NOT NULL, payload jsonb NOT NULL)');
await pool.query('INSERT INTO ricos_state(id,version,payload) VALUES(1,$1,$2) ON CONFLICT DO NOTHING',[crypto.randomUUID(),JSON.stringify({units:seed.units,chairs:[],evals:[],goals:[],history:[]})]);}
const initial=()=>({units:seed.units,chairs:[],evals:[],goals:[],history:[]});
const server=http.createServer(async(req,res)=>{
 const send=(s,data,extra={})=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(data));};
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health')return send(200,{ok:true,databaseConfigured:!!pool});
  if(path==='/api/status')return send(200,{databaseConfigured:!!pool});
  if(path==='/seed')return send(200,{source:'Planilhas fornecidas'});
  if(path==='/'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html)}
  if(path!=='/api/state')return send(404,{error:'Não encontrado'});
  if(!pool){if(req.method==='GET')return send(200,initial(),{ETag:'setup-required'});return send(503,{error:'Configure DATABASE_URL no Render para habilitar os registros compartilhados.'})}
  if(req.method==='GET'){const {rows:[row]}=await pool.query('SELECT version,payload FROM ricos_state WHERE id=1');return send(200,row.payload,{ETag:row.version})}
  if(req.method!=='PUT')return send(405,{error:'Método não permitido'});
  const origin=req.headers.origin;if(!origin||new URL(origin).host!==req.headers.host)return send(403,{error:'Origem inválida'});
  let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>6000000)return send(413,{error:'Limite excedido'});chunks.push(c)}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString())}catch{return send(400,{error:'JSON inválido'})}
  if(!['units','chairs','evals','goals','history'].every(k=>Array.isArray(data[k])))return send(400,{error:'Formato inválido'});
  if(!data.units.every(u=>typeof u.id==='string'&&typeof u.name==='string'&&Number.isFinite(u.actual)&&Number.isFinite(u.chairs)&&Number.isFinite(u.target)))return send(400,{error:'Unidades inválidas'});
  const version=crypto.randomUUID();const result=await pool.query('UPDATE ricos_state SET version=$1,payload=$2 WHERE id=1 AND version=$3',[version,JSON.stringify(data),req.headers['if-match']||'']);
  if(!result.rowCount)return send(409,{error:'Os dados foram atualizados por outra pessoa. Recarregue a página.'});
  return send(200,{ok:true},{ETag:version});
 }catch(e){console.error(e.message);send(500,{error:'Falha ao acessar dados'})}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0');
process.on('SIGTERM',()=>server.close(async()=>{await pool?.end();process.exit(0)}));
