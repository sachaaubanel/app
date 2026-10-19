'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const PORT=Number(process.env.PORT||3000);
const PASSWORD=process.env.TEAM_PASSWORD;
if(!PASSWORD||PASSWORD.length<10){console.error('Définir TEAM_PASSWORD (10 caractères minimum)');process.exit(1)}
const SECRET=crypto.createHash('sha256').update(PASSWORD+':bureau-session').digest('hex');
const file=path.resolve(process.env.DB_PATH||'./data/bureau.sqlite');
fs.mkdirSync(path.dirname(file),{recursive:true});
const db=new DatabaseSync(file);
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY,group_id TEXT NOT NULL,room INTEGER NOT NULL,name TEXT NOT NULL,quantity INTEGER NOT NULL,date TEXT NOT NULL,half TEXT NOT NULL);CREATE INDEX IF NOT EXISTS slots ON bookings(room,date,half);");
const all=db.prepare('SELECT id,group_id AS groupId,room,name,quantity,date,half FROM bookings WHERE date>=? ORDER BY date,half,room');
const byGroup=db.prepare('SELECT id FROM bookings WHERE group_id=?');
const occupied=db.prepare('SELECT coalesce(sum(quantity),0) AS n FROM bookings WHERE room=? AND date=? AND half=?');
const insert=db.prepare('INSERT INTO bookings (id,group_id,room,name,quantity,date,half) VALUES (?,?,?,?,?,?,?)');
const del=db.prepare('DELETE FROM bookings WHERE group_id=?');
const clients=new Set(),fails=new Map();
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const same=(a,b)=>crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(),crypto.createHash('sha256').update(String(b)).digest());
const sign=data=>crypto.createHmac('sha256',SECRET).update(data).digest('base64url');
function session(){const v=Buffer.from(JSON.stringify({until:Date.now()+60*86400000})).toString('base64url');return v+'.'+sign(v)}
function auth(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('bureau_session='));if(!cookie)return false;const [v,s]=cookie.slice(15).split('.');if(!v||!s||!same(s,sign(v)))return false;try{return JSON.parse(Buffer.from(v,'base64url')).until>Date.now()}catch{return false}}
const reply=(res,status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(data))};
const fail=(res,message,code=400)=>reply(res,code,{error:message});
function payload(req){return new Promise((resolve,reject)=>{let s='';req.on('data',x=>{s+=x;if(s.length>25000){reject(Error('Requête trop longue'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{reject(Error('JSON invalide'))}});req.on('error',reject)})}
function validated(b){
const room=Number(b.room),quantity=Number(b.quantity),name=String(b.name||'').trim(),slots=b.slots;
if(!Number.isInteger(room)||room<1||room>6)throw Error('Salle invalide');
if(!Number.isInteger(quantity)||quantity<1||quantity>(room<3?2:1))throw Error('Capacité dépassée');
if(name.length<2||name.length>80)throw Error('Nom invalide');
if(!Array.isArray(slots)||!slots.length||slots.length>365)throw Error('Créneaux invalides');
const keys=new Set();
for(const s of slots){if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date||'')||!['AM','PM'].includes(s.half))throw Error('Date ou demi-journée invalide');const dt=new Date(s.date+'T12:00:00Z');if(!Number.isFinite(+dt)||dt.toISOString().slice(0,10)!==s.date||s.date<today())throw Error('Date passée ou invalide');const key=s.date+'|'+s.half;if(keys.has(key))throw Error('Créneau en double');keys.add(key)}
return {room,quantity,name,slots};
}
function broadcast(){for(const c of [...clients])try{c.write('event: change\ndata: {}\n\n')}catch{clients.delete(c)}}
function save(data,old){
const b=validated(data),id=old||crypto.randomUUID();
db.exec('BEGIN IMMEDIATE');
try{
 if(old){if(!byGroup.get(old))throw Error('Réservation introuvable');del.run(old)}
 for(const s of b.slots)if(occupied.get(b.room,s.date,s.half).n+b.quantity>(b.room<3?2:1))throw Error('Salle complète le '+s.date+' '+s.half);
 for(const s of b.slots)insert.run(crypto.randomUUID(),id,b.room,b.name,b.quantity,s.date,s.half);
 db.exec('COMMIT');broadcast();return {groupId:id};
}catch(e){db.exec('ROLLBACK');throw e}
}
function remove(id){db.exec('BEGIN IMMEDIATE');try{if(!del.run(id).changes)throw Error('Réservation introuvable');db.exec('COMMIT');broadcast();return {ok:true}}catch(e){db.exec('ROLLBACK');throw e}}
const server=http.createServer(async(req,res)=>{
const url=new URL(req.url||'/', 'http://localhost'),p=url.pathname;
try{
 if(p==='/healthz')return reply(res,200,{ok:true});
 if(p==='/api/status')return reply(res,200,{authenticated:auth(req),today:today()});
 if(p==='/api/login'&&req.method==='POST'){
 const ip=String(req.socket.remoteAddress);const f=fails.get(ip)||{count:0,reset:Date.now()+900000};if(Date.now()>f.reset){f.count=0;f.reset=Date.now()+900000}if(f.count>=15)return fail(res,'Trop de tentatives',429);
 const b=await payload(req);if(!same(b.password||'',PASSWORD)){f.count++;fails.set(ip,f);return fail(res,'Code équipe incorrect',401)}fails.delete(ip);
 return reply(res,200,{ok:true},{'set-cookie':'bureau_session='+session()+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=5184000'+(process.env.NODE_ENV==='production'?'; Secure':'')});
 }
 if(p==='/api/logout'&&req.method==='POST')return reply(res,200,{ok:true},{'set-cookie':'bureau_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
 if(p.startsWith('/api/')&&!auth(req))return fail(res,'Veuillez vous connecter',401);
 if(p==='/api/bookings'&&req.method==='GET')return reply(res,200,all.all(today()));
 if(p==='/api/bookings'&&req.method==='POST')return reply(res,201,save(await payload(req),null));
 if(/^\/api\/bookings\/[0-9a-f-]{36}$/i.test(p)&&req.method==='PATCH')return reply(res,200,save(await payload(req),p.split('/')[3]));
 if(p==='/api/bookings'&&req.method==='DELETE'){const b=await payload(req);if(!/^[0-9a-f-]{36}$/i.test(String(b.groupId||'')))return fail(res,'ID invalide');return reply(res,200,remove(b.groupId))}
 if(p==='/api/events'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});res.write('event: connected\ndata: {}\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return}
 if((p==='/'||p==='/index.html')&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff','x-frame-options':'DENY'});if(req.method==='HEAD')return res.end();return fs.createReadStream(path.join(__dirname,'index.html')).pipe(res)}
 return fail(res,'Introuvable',404);
}catch(e){console.error(e.message);return fail(res,e.message||'Erreur du serveur')}
});
setInterval(()=>{for(const c of [...clients])try{c.write(': ping\n\n')}catch{clients.delete(c)}},20000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log('Bureau équipe en écoute sur '+PORT));
