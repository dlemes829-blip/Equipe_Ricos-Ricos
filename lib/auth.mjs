import crypto from 'node:crypto';
export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
export function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');return 'scrypt:'+salt+':'+crypto.scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')}
export function verifyPassword(password,hash){const parts=String(hash||'').split(':'),valid=parts[0]==='scrypt'&&/^[a-f0-9]{32}$/.test(parts[1]||'')&&/^[a-f0-9]{128}$/.test(parts[2]||'');const salt=valid?parts[1]:'0'.repeat(32),expected=Buffer.from(valid?parts[2]:'0'.repeat(128),'hex'),actual=crypto.scryptSync(String(password),Buffer.from(salt,'hex'),64);return crypto.timingSafeEqual(actual,expected)&&valid}
export function cookieValue(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('amanda_session='))?.slice('amanda_session='.length)||''}
export function sessionCookie(token){return 'amanda_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'}
export const clearCookie='amanda_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
export * from './access.mjs';
