import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase,seedDatabase } from '../lib/db.mjs';
import { createAuthService,safeReturnPath } from '../lib/auth.mjs';
import * as comm from '../lib/communications.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'hc-auth-'));const {db}=openDatabase(dir);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const env={NODE_ENV:'test',AUTH_MODE:'kakao',APP_ORIGIN:'https://care.example',KAKAO_CLIENT_ID:'fixture',KAKAO_CLIENT_SECRET:'fixture-secret',CLINICIAN_KAKAO_IDS:'101'};
 let clock=Date.now();const calls=[];
 const auth=createAuthService({db,env,now:()=>clock,fetchImpl:async(url,options)=>{calls.push({url,options});if(url==='https://kauth.kakao.com/oauth/token')return Response.json({access_token:new URLSearchParams(options.body).get('code')});if(url==='https://kapi.kakao.com/v2/user/me')return Response.json({id:options.headers.Authorization.slice(7)});throw Error('unexpected URL');}});
 comm.ensureCommunicationSchema(db);
 async function login(id,old={headers:{}}){const start=auth.startOAuth(old,'/clinician');const state=new URL(start.location).searchParams.get('state');const req={headers:{...old.headers,cookie:[old.headers.cookie,start.cookie.split(';')[0]].filter(Boolean).join('; ')}};const url=new URL('https://care.example/auth/kakao/callback');url.search=new URLSearchParams({state,code:id});const result=await auth.finishOAuth(req,url);const current={headers:{cookie:result.cookies[0].split(';')[0]}};current.headers['x-csrf-token']=auth.sessionInfo(current).csrfToken;return {req:current,result,start,callback:url};}
 return {db,auth,env,calls,login,tick:ms=>clock+=ms};
}
const status=(code)=>error=>error.status===code;
test('OAuth uses fixed endpoints, browser-bound single-use state and secure rotating hashed sessions',async t=>{
 const {db,auth,login,calls}=fixture(t);const first=await login('101');assert.equal(auth.actor(first.req).role,'clinician');
 assert.equal(auth.actor({headers:{'x-homecare-demo-session':first.req.headers.cookie.split('=')[1]}}),null);
 assert.equal(auth.actor({headers:{...first.req.headers,'x-homecare-demo-session':'untrusted-demo-header'}}).role,'clinician');
 assert.match(first.result.cookies[0],/__Host-hc_session=.*HttpOnly; SameSite=Lax; Max-Age=43200; Secure/);
 assert.equal(db.prepare('SELECT token_hash FROM auth_sessions').get().token_hash.includes(first.req.headers.cookie.split('=')[1]),false);
 assert.ok(!JSON.stringify(db.prepare('SELECT * FROM auth_accounts').all()).includes('fixture-secret'));
 assert.deepEqual(calls.map(c=>c.url),['https://kauth.kakao.com/oauth/token','https://kapi.kakao.com/v2/user/me']);
 assert.equal(new URLSearchParams(calls[0].options.body).get('redirect_uri'),'https://care.example/auth/kakao/callback');
 await assert.rejects(auth.finishOAuth({headers:{cookie:first.start.cookie.split(';')[0]}},first.callback),status(400));
 const second=await login('101',first.req);assert.equal(auth.actor(first.req),null);assert.ok(auth.actor(second.req));
 assert.throws(()=>auth.authorize({headers:{cookie:second.req.headers.cookie}},{staff:true,write:true}),status(403));
 auth.logout(second.req);assert.equal(auth.actor(second.req),null);
});
test('OAuth wrong browser, expiry, provider failures and unsafe return URLs cannot grant a session',async t=>{
 const {auth,tick,db,env}=fixture(t);const start=auth.startOAuth({headers:{}},'//evil.example');const state=new URL(start.location).searchParams.get('state');const url=new URL(`https://care.example/auth/kakao/callback?state=${state}&code=101`);
 await assert.rejects(auth.finishOAuth({headers:{cookie:'__Host-hc_login='+'a'.repeat(43)}},url),status(400));assert.equal(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);
 tick(600001);await assert.rejects(auth.finishOAuth({headers:{cookie:start.cookie.split(';')[0]}},url),status(400));
 for(const path of ['//evil.test','https://evil.test','/\\evil.test','/login','/patient/../auth/kakao'])assert.equal(safeReturnPath(path),null);
 assert.equal(safeReturnPath('/patient?view=messages&evil=x'),'/patient?view=messages');
 env.KAKAO_CLIENT_SECRET='';assert.equal(auth.capabilities().kakaoAvailable,false);assert.throws(()=>auth.startOAuth({headers:{}},'/patient'),status(503));assert.throws(()=>auth.demoLogin({headers:{'x-homecare-demo':'1'}},{role:'clinician'}),status(403));
});
test('One-use invitations bind only pending accounts and isolate charts; allowlist removal is immediate',async t=>{
 const {auth,login,env,db}=fixture(t);const staff=await login('101'),patient=await login('201'),other=await login('202');
 assert.equal(auth.actor(patient.req).role,'pending');assert.throws(()=>auth.authorize(patient.req,{patientId:'p001'}),status(403));
 const revoked=auth.issueInvitation(staff.req,'p001');const invitation=auth.issueInvitation(staff.req,'p001');
 assert.throws(()=>auth.enroll(patient.req,{code:revoked.code}),status(400));auth.enroll(patient.req,{code:invitation.code});
 assert.equal(auth.actor(patient.req).patientId,'p001');assert.throws(()=>auth.enroll(other.req,{code:invitation.code}),status(400));
 assert.throws(()=>auth.authorize(patient.req,{patientId:'p002'}),status(403));assert.throws(()=>auth.authorize(patient.req,{staff:true}),status(403));
 const conflict=auth.issueInvitation(staff.req,'p001');assert.throws(()=>auth.enroll(other.req,{code:conflict.code}),status(409));
 env.CLINICIAN_KAKAO_IDS='';assert.equal(auth.actor(staff.req).role,'pending');assert.throws(()=>auth.issueInvitation(staff.req,'p002'),status(403));
 env.CLINICIAN_KAKAO_IDS='101';seedDatabase(db,'seed');assert.equal(auth.actor(patient.req).role,'pending');assert.equal(auth.actor(staff.req).role,'clinician');
});
test('Notice lifecycle has optimistic revisions, per-account read versions and hidden drafts/archive',async t=>{
 const {auth,login,db}=fixture(t);const staff=auth.actor((await login('101')).req),patient=auth.actor((await login('201')).req);patient.role='patient';patient.patientId='p001';
 let {notice}=comm.createNotice(db,staff,{title:'<script>notice</script>',body:'plain text',status:'draft',pinned:true});assert.equal(comm.activeNotices(db,patient).notices.length,0);
 notice=comm.updateNotice(db,staff,notice.id,{...{title:notice.title,body:notice.body,pinned:true},status:'published',version:notice.version}).notice;
 assert.equal(comm.activeNotices(db,patient).notices[0].read,false);comm.readNotice(db,patient,notice.id,{version:notice.version});assert.equal(comm.activeNotices(db,patient).notices[0].read,true);
 assert.throws(()=>comm.updateNotice(db,staff,notice.id,{title:'conflict',body:'x',pinned:false,status:'published',version:1}),status(409));
 notice=comm.updateNotice(db,staff,notice.id,{title:'updated',body:'x',pinned:false,status:'published',version:notice.version}).notice;assert.equal(comm.activeNotices(db,patient).notices[0].read,false);
 assert.throws(()=>comm.readNotice(db,patient,notice.id,{version:2}),status(409));
 comm.updateNotice(db,staff,notice.id,{title:'archive',body:'x',pinned:false,status:'archived',version:notice.version});assert.equal(comm.activeNotices(db,patient).notices.length,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM notice_revisions').get().n,4);
 assert.throws(()=>comm.createNotice(db,patient,{title:'x',body:'x',status:'published',pinned:false}),status(403));
});
test('Messages isolate patients, deduplicate retries, page without gaps and record explicit monotonic reads',async t=>{
 const {auth,login,db}=fixture(t);const staff=auth.actor((await login('101')).req),patient=auth.actor((await login('201')).req);patient.role='patient';patient.patientId='p001';
 const input={body:'안내 <img onerror=alert(1)>',clientMessageId:randomUUID()};const first=comm.sendMessage(db,staff,'p001',input);assert.equal(comm.sendMessage(db,staff,'p001',input).duplicate,true);
 assert.throws(()=>comm.sendMessage(db,staff,'p001',{...input,body:'different'}),status(409));assert.throws(()=>comm.listMessages(db,patient,'p002'),status(403));
 assert.equal(comm.listMessages(db,patient,'p001').unread,1);assert.equal(comm.listMessages(db,staff,'p001').messages[0].readByOther,false);
 comm.readMessages(db,patient,'p001',{throughId:first.message.id});assert.equal(comm.listMessages(db,staff,'p001').messages[0].readByOther,true);
 const foreign=comm.sendMessage(db,staff,'p002',{body:'private',clientMessageId:randomUUID()});assert.throws(()=>comm.readMessages(db,patient,'p001',{throughId:foreign.message.id}),status(400));
 for(let i=0;i<55;i++)comm.sendMessage(db,patient,'p001',{body:'reply '+i,clientMessageId:randomUUID()});
 const latest=comm.listMessages(db,staff,'p001');assert.equal(latest.messages.length,50);assert.equal(latest.hasMore,true);const earlier=comm.listMessages(db,staff,'p001',{before:latest.nextBefore});assert.equal(earlier.messages.length,6);assert.ok(earlier.messages.at(-1).id<latest.messages[0].id);
 assert.equal(comm.conversations(db,staff).conversations.find(c=>c.patientId==='p001').unread,55);
 comm.readMessages(db,staff,'p001',{throughId:latest.nextAfter});comm.readMessages(db,staff,'p001',{throughId:first.message.id});assert.equal(comm.conversations(db,staff).conversations.find(c=>c.patientId==='p001').unread,0);
 seedDatabase(db,'empty');assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
});

test('Session expiry and invalid production configuration fail closed without demo fallback',async t=>{
 const {auth,login,tick,env}=fixture(t);const session=await login('101');tick(12*60*60*1000);assert.equal(auth.actor(session.req),null);assert.throws(()=>auth.authorize(session.req,{staff:true}),status(401));
 env.AUTH_MODE='typo';assert.equal(auth.capabilities().mode,'kakao');assert.equal(auth.capabilities().kakaoAvailable,false);assert.throws(()=>auth.demoLogin({headers:{'x-homecare-demo':'1'}},{role:'clinician'}),status(403));
});

test('Provider failures produce a generic error, keep secrets out of errors and never create a session',async t=>{
 const {db,env}=fixture(t);const auth=createAuthService({db,env,fetchImpl:async()=>new Response('sensitive provider body fixture-secret',{status:401})});
 const start=auth.startOAuth({headers:{}},'/patient'),state=new URL(start.location).searchParams.get('state');
 await assert.rejects(auth.finishOAuth({headers:{cookie:start.cookie.split(';')[0]}},new URL('https://care.example/auth/kakao/callback?state='+state+'&code=101')),error=>error.status===502&&!error.message.includes('fixture-secret')&&!error.message.includes('sensitive'));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);
});
