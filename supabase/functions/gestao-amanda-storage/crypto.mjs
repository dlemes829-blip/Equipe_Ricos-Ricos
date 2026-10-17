// Authenticated encryption; keys are supplied only by the trusted Node backend.
const encoder=new TextEncoder(),decoder=new TextDecoder();
export const protectedFields={
 amanda_browser_vault:{payload:'json'},
 amanda_browser_config:{payload:'json'},
 amanda_report_jobs:{payload:'json'},
 gestao_amanda_state:{payload:'json'},
 amanda_users:{username:'text',name:'text',password_hash:'text',manager:'text',requested_manager:'text'},
 amanda_notifications:{title:'text',body:'text'},
 amanda_push_subscriptions:{endpoint:'text',subscription:'json'},
 amanda_feature_requests:{title:'text',description:'text',developer_note:'text'},
 amanda_audit:{detail:'json',target_id:'text'},
 amanda_sheet_records:{data:'json',owner_manager:'text',suggested_manager:'text'}
};
const lookups={amanda_users:{username:'username_lookup'},amanda_push_subscriptions:{endpoint:'endpoint_lookup'},amanda_sheet_records:{owner_manager:'owner_lookup'}};
const hex=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
const b64=b=>{let s='';for(const byte of new Uint8Array(b))s+=String.fromCharCode(byte);return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
export function isEncrypted(value,type){return type==='json'?value?.$amanda==='aes-256-gcm:v1':typeof value==='string'&&value.startsWith('enc:v1:')}
export async function createCodec(secret){
 if(!/^[a-f0-9]{64}$/.test(secret||''))throw Error('Encryption key unavailable');
 const master=await crypto.subtle.importKey('raw',unhex(secret),'HKDF',false,['deriveKey']);
 const derive=(info,algorithm,usage)=>crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('gestao-amanda:v1'),info:encoder.encode(info)},master,algorithm,false,usage);
 const encryption=await derive('data-encryption',{name:'AES-GCM',length:256},['encrypt','decrypt']);
 const search=await derive('blind-index',{name:'HMAC',hash:'SHA-256',length:256},['sign']);
 const blind=async(context,value)=>hex(await crypto.subtle.sign('HMAC',search,encoder.encode(context+'\0'+value)));
 async function seal(value,context,type){if(value===null||value===undefined)return value;const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context),tagLength:128},encryption,encoder.encode(JSON.stringify(value)));const box={iv:b64(iv),data:b64(data)};return type==='json'?{$amanda:'aes-256-gcm:v1',...box}:'enc:v1:'+box.iv+':'+box.data}
 async function open(value,context,type){if(value===null||value===undefined||value==='')return value;if(!isEncrypted(value,type))throw Error('Unencrypted private field');const box=type==='json'?value:{iv:value.split(':')[2],data:value.split(':')[3]};const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(box.iv),additionalData:encoder.encode(context),tagLength:128},encryption,unb64(box.data));return JSON.parse(decoder.decode(bytes))}
 async function encode(table,row){const out={...row};for(const [field,type]of Object.entries(protectedFields[table]||{})){if(!(field in row))continue;const v=row[field];if(isEncrypted(v,type))throw Error('Refusing encrypted input');if(lookups[table]?.[field])out[lookups[table][field]]=v==null?null:await blind(table+'.'+field,v);out[field]=await seal(v,table+'.'+field,type)}if(table==='amanda_login_attempts'&&'attempt_key'in out)out.attempt_key=await blind('login-attempt',out.attempt_key);return out}
 async function decode(table,row){const out={...row};for(const [field,type]of Object.entries(protectedFields[table]||{}))if(field in out)out[field]=await open(out[field],table+'.'+field,type);for(const k of Object.values(lookups[table]||{}))delete out[k];if(table==='amanda_sessions'&&out.user)out.user=await decode('amanda_users',out.user);return out}
 async function query(table,params){const out={...params};for(const [field,column]of Object.entries(lookups[table]||{})){if(out[field]!==undefined&&String(out[field]).startsWith('eq.')){out[column]='eq.'+await blind(table+'.'+field,String(out[field]).slice(3));delete out[field]}if(out.on_conflict===field)out.on_conflict=column}if(table==='amanda_login_attempts'&&String(out.attempt_key||'').startsWith('eq.'))out.attempt_key='eq.'+await blind('login-attempt',out.attempt_key.slice(3));return out}
 return {seal,open,blind,encode,decode,query};
}
export function encryptedDatabase(raw,codec){return async(table,params={},method='GET',body)=>{
 const transformed=await codec.query(table,params);
 let rows=await raw(table,transformed,method,body?await codec.encode(table,body):undefined);
 return Promise.all(rows.map(row=>codec.decode(table,row)));
}}
export async function migrateBatch(raw,codec,table,offset=0){
 if(!protectedFields[table]&&table!=='amanda_login_attempts')throw Error('Invalid migration table');
 const rows=await raw(table,{select:'*',order:'id.asc',limit:100,offset});let changed=0,conflicts=0;
 for(let i=0;i<rows.length;i+=8)await Promise.all(rows.slice(i,i+8).map(async row=>{
  const fields=protectedFields[table]||{},plain={};for(const [field,type]of Object.entries(fields))if(row[field]!=null&&!isEncrypted(row[field],type))plain[field]=row[field];
  // Old attempt records expire naturally. Hash their existing login labels once.
  if(table==='amanda_login_attempts'&&!/^[a-f0-9]{64}$/.test(row.attempt_key))plain.attempt_key=row.attempt_key;
  if(!Object.keys(plain).length)return;
  const params={id:'eq.'+row.id,select:'id'};if(row.version)params.version='eq.'+row.version;else if(row.updated_at)params.updated_at='eq.'+row.updated_at;else if(table==='amanda_users'){params.username='eq.'+row.username;if(row.password_hash)params.password_hash='eq.'+row.password_hash}
  const saved=await raw(table,params,'PATCH',await codec.encode(table,plain));saved.length?changed++:conflicts++;
 }));return {table,scanned:rows.length,changed,conflicts,next:rows.length===100?offset+100:null};
}
