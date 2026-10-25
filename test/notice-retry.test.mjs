import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{openDatabase,seedDatabase}from'../lib/db.mjs';import{createAuthService}from'../lib/auth.mjs';import{ensureCommunicationSchema,createNotice,updateNotice,listNotices,activeNotices}from'../lib/communications.mjs';import{staffAccessFor}from'../lib/staff-access.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'homecare-notice-'));const{db}=openDatabase(dir);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});const auth=createAuthService({db,env:{AUTH_MODE:'demo',NODE_ENV:'test'}});ensureCommunicationSchema(db);const result=auth.demoLogin({headers:{'x-homecare-demo':'1'}},{role:'clinician'});const cookie=result.cookies?.[0]||result.cookie;const req={headers:{cookie:cookie.split(';')[0]}};return{db,actor:auth.actor(req)};}
// Use a real service-created demo account; no publicly deployed service is contacted.
test('NOTICE same-body retry returns saved create/update without duplicate revision',t=>{
 const{db,actor}=fixture(t),clientRequestId=randomUUID(),input={title:'[합성] 안내',body:'검증 공지',status:'published',pinned:false,clientRequestId};
 const first=createNotice(db,actor,input);assert.deepEqual(createNotice(db,actor,{...input}),first);assert.equal(listNotices(db,actor).notices.length,1);assert.throws(()=>createNotice(db,actor,{...input,body:'changed'}),e=>e.status===409);
 const patch={...input,body:'수정 검증',version:first.notice.version,clientRequestId:randomUUID()};const updated=updateNotice(db,actor,first.notice.id,patch);assert.deepEqual(updateNotice(db,actor,first.notice.id,patch),updated);assert.equal(db.prepare('SELECT COUNT(*) n FROM notice_revisions').get().n,2);
 assert.throws(()=>updateNotice(db,actor,first.notice.id,{...patch,clientRequestId:randomUUID()}),e=>e.status===409);
 seedDatabase(db,'empty');assert.equal(db.prepare('SELECT COUNT(*) n FROM notice_submissions').get().n,0);
});
test('NOTICE assigned-patient staff cannot broadcast to the entire service, even on replay',t=>{
 const{db,actor}=fixture(t);const input={title:'[합성] 안내',body:'검증 공지',status:'published',pinned:false,clientRequestId:randomUUID()};createNotice(db,actor,input);
 const scoped={...actor,assignedPatientIds:['p001']};assert.throws(()=>createNotice(db,scoped,input),e=>e.status===403);assert.throws(()=>listNotices(db,scoped),e=>e.status===403);
 const access=staffAccessFor({provider:'kakao',providerId:'900'},{STAFF_ACCESS_JSON:JSON.stringify({'900':{roles:['clinician'],patientIds:['p001']}})});assert.ok(!access.capabilities.includes('notice.write'));
 assert.equal(activeNotices(db,{...actor,role:'patient',patientId:'p002'}).notices.length,1);
});
test('DEMO tab sessions retain distinct roles and patient identities despite shared cookie changes',t=>{
 const{db}=fixture(t);const auth=createAuthService({db,env:{AUTH_MODE:'demo',NODE_ENV:'test'}});
 const c=auth.demoLogin({headers:{'x-homecare-demo':'1'}},{role:'clinician'});
 const p=auth.demoLogin({headers:{'x-homecare-demo':'1',cookie:c.cookie.split(';')[0]}},{role:'patient',patientId:'p001'});
 const p2=auth.demoLogin({headers:{'x-homecare-demo':'1',cookie:p.cookie.split(';')[0]}},{role:'patient',patientId:'p002'});
 const make=token=>({headers:{cookie:p2.cookie.split(';')[0],'x-homecare-demo-session':token}});
 assert.equal(auth.actor(make(c.demoToken)).role,'clinician');assert.equal(auth.actor(make(p.demoToken)).patientId,'p001');assert.equal(auth.actor(make(p2.demoToken)).patientId,'p002');assert.equal(auth.actor(make('invalid')),null);
 const logout=make(p.demoToken);logout.headers['x-csrf-token']=auth.sessionInfo(logout).csrfToken;auth.logout(logout);assert.equal(auth.actor(make(p.demoToken)),null);assert.equal(auth.actor(make(c.demoToken)).role,'clinician');assert.equal(auth.actor(make(p2.demoToken)).patientId,'p002');
});
