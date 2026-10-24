import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { DatabaseSync } from 'node:sqlite';
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const base=`http://127.0.0.1:${port}`,dir=await mkdtemp(join(tmpdir(),'hc-auth-browser-'));
let output='',browser;
const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--import','./test/helpers/kakao-provider-fixture.mjs','--import','./test/helpers/medication-vision-fixture.mjs','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',VISION_ENABLED:'true',HOMECARE_VISION_API_KEY:'fixture-only-not-real',AUTH_MODE:'kakao',APP_ORIGIN:base,KAKAO_CLIENT_ID:'fixture',KAKAO_CLIENT_SECRET:'fixture-secret',CLINICIAN_KAKAO_IDS:'101',PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);
const issues=[];
async function login(context,id,next='/clinician'){
 const page=await context.newPage();page.on('pageerror',e=>issues.push(e.message));
 await page.goto(base+'/login?next='+encodeURIComponent(next));await page.locator('#kakao-login').waitFor();
 const start=await context.request.get(base+await page.locator('#kakao-login').getAttribute('href'),{maxRedirects:0});
 assert.equal(start.status(),302);const provider=new URL(start.headers().location);assert.equal(provider.origin,'https://kauth.kakao.com');
 // Simulate only the provider's browser redirect; no external network or TLS exception.
 await page.goto(`${base}/auth/kakao/callback?state=${provider.searchParams.get('state')}&code=fixture-${id}`);
 await page.waitForURL(url=>url.origin===base&&['/clinician','/account','/patient'].includes(url.pathname),{timeout:10000});
 return page;
}
async function write(context,path,body,method='POST',csrf=true){const session=await(await context.request.get(base+'/api/auth/session')).json();return context.request.fetch(base+path,{method,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':session.csrfToken}:{})},data:body});}
async function eventually(check){for(let i=0;i<60;i++){if(await check())return;await delay(100);}throw Error('Condition timed out');}
try{
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error(output);await delay(100);}
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(base+'/api/dashboard')).status(),401);assert.equal((await anonymous.request.get(base+'/api/patients/p001/summary')).status(),401);
 assert.equal((await anonymous.request.post(base+'/api/auth/demo',{headers:{'X-HomeCare-Demo':'1'},data:{role:'clinician'}})).status(),403);
 assert.equal((await anonymous.request.get(base+'/api/health')).status(),200);assert.equal((await(await anonymous.request.get(base+'/api/health')).json()).counts,undefined);
 const staff=await browser.newContext({viewport:{width:1440,height:1000}}),patient=await browser.newContext({viewport:{width:390,height:844}}),other=await browser.newContext({viewport:{width:320,height:740}});
 const clinician=await login(staff,'101','');await clinician.locator('#app-content:not([hidden])').waitFor();
 assert.equal((await write(staff,'/api/clinician/notices',{title:'x',body:'x',status:'published',pinned:false},'POST',false)).status(),403);
 const invite=await write(staff,'/api/clinician/patients/p001/invitations',{});assert.equal(invite.status(),201);const code=(await invite.json()).invitation.code;
 const mobile=await login(patient,'201','/patient');assert.equal(new URL(mobile.url()).pathname,'/account');assert.equal((await patient.request.get(base+'/api/patients')).status(),403);
 await mobile.locator('#invitation-code').fill(code);await mobile.locator('#enrollment-submit').click();await mobile.waitForURL('**/patient**');await mobile.locator('#app-content:not([hidden])').waitFor();
 const third=await login(other,'202','/patient');const invite2=await write(staff,'/api/clinician/patients/p002/invitations',{});await third.locator('#invitation-code').fill((await invite2.json()).invitation.code);await third.locator('#enrollment-submit').click();await third.waitForURL('**/patient**');await third.locator('#app-content:not([hidden])').waitFor();
 assert.equal(await mobile.locator('#patient-select').isHidden(),true);assert.deepEqual((await(await patient.request.get(base+'/api/patients')).json()).patients.map(p=>p.id),['p001']);
 for(const path of ['/api/dashboard','/api/export.csv','/api/patients/p002/summary','/api/patients/p002/messages','/api/clinician/notices','/api/clinician/conversations'])assert.equal((await patient.request.get(base+path)).status(),403,path);
 assert.equal((await write(patient,'/api/patients/p002/daily',{steps:5})).status(),403);assert.equal((await write(patient,'/api/patients/p001/medication-orders',{})).status(),403);
 assert.equal((await write(patient,'/api/clinician/patients/p001/invitations',{})).status(),403);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WlEAAAAASUVORK5CYII=';
 const meal=await write(patient,'/api/patients/p001/meals',{mealType:'lunch',foodType:'balanced',portion:1,imageData:png});assert.equal(meal.status(),201);const photo=(await meal.json()).meal.imageUrl;assert.ok(photo);assert.equal((await patient.request.get(base+photo)).status(),200);assert.equal((await other.request.get(base+photo)).status(),403);assert.equal((await anonymous.request.get(base+photo)).status(),401);
 // New medication photo evidence follows the same own-patient ACL and CSRF contract.
 const date=(await(await staff.request.get(base+'/api/patients/p001/summary')).json()).today;
 const orderResponse=await write(staff,'/api/patients/p001/medication-orders',{name:'가상약A',strength:'5mg',dose:'1정',times:['08:00'],startDate:date});assert.equal(orderResponse.status(),201);const order=(await orderResponse.json()).order;
 const analysisResponse=await write(patient,'/api/patients/p001/photo-analyses',{kind:'medication',imageData:png,consentExternalProcessing:true});assert.equal(analysisResponse.status(),201);const analysis=(await analysisResponse.json()).analysis;
 const photoBody={clientSubmissionId:crypto.randomUUID(),analysisId:analysis.id,imageData:png,date,patientConfirmed:true,slots:[{orderId:order.id,time:'08:00',status:'taken',expectedRevision:0}]};
 assert.equal((await write(patient,'/api/patients/p001/medication-photo-reports',photoBody,'POST',false)).status(),403);
 assert.equal((await write(other,'/api/patients/p001/medication-photo-reports',photoBody)).status(),403);
 const medicationPhotoResponse=await write(patient,'/api/patients/p001/medication-photo-reports',photoBody);assert.equal(medicationPhotoResponse.status(),201);const medicationPhoto=(await medicationPhotoResponse.json()).report;
 assert.equal((await patient.request.get(base+medicationPhoto.imageUrl)).status(),200);assert.equal((await staff.request.get(base+medicationPhoto.imageUrl)).status(),200);
 assert.equal((await other.request.get(base+medicationPhoto.imageUrl)).status(),403);assert.equal((await anonymous.request.get(base+medicationPhoto.imageUrl)).status(),401);
 assert.equal((await patient.request.get(base+'/api/patients/p002/medication-photo-reports?date='+date)).status(),403);
 console.log('PASS strict OAuth fixture, enrollment, CSRF, chart/role/photo isolation');
 await clinician.locator('#main-nav [data-view=notices]').click();await clinician.locator('#notice-title').fill('검사 안내 <script>window.xss=1</script>');await clinician.locator('#notice-body').fill('내원 전 기록을 확인해 주세요.\n<img src=x onerror="window.xss=1">');
 await clinician.locator('#notice-form [type=submit]').click();await eventually(async()=>!await clinician.locator('#notice-form [type=submit]').isDisabled());
 assert.equal((await(await patient.request.get(base+'/api/notices/active')).json()).notices.length,0);
 await clinician.locator('#notice-status').selectOption('published');await clinician.locator('#notice-pinned').check();await clinician.locator('#notice-form [type=submit]').click();await eventually(async()=> (await(await patient.request.get(base+'/api/notices/active')).json()).notices.length===1);
 await mobile.reload();await mobile.locator('#app-content:not([hidden])').waitFor();await mobile.locator('.patient-notice summary').waitFor();assert.ok((await mobile.locator('#patient-notices').boundingBox()).y<(await mobile.locator('.greeting').boundingBox()).y);
 await mobile.locator('.patient-notice summary').click();await eventually(async()=>!(await mobile.locator('.notice-new').count()));assert.equal(await mobile.evaluate(()=>window.xss),undefined);assert.equal(await mobile.locator('#patient-notices script,#patient-notices img').count(),0);
 await clinician.locator('#notice-body').fill('수정된 안내');await clinician.locator('#notice-form [type=submit]').click();await eventually(async()=>!(await(await patient.request.get(base+'/api/notices/active')).json()).notices[0].read);
 // Optimistic conflict keeps the unsaved draft for review.
 let n=(await(await staff.request.get(base+'/api/clinician/notices')).json()).notices[0];await write(staff,'/api/clinician/notices/'+n.id,{title:n.title,body:'다른 창',status:n.status,pinned:n.pinned,version:n.version},'PATCH');
 await clinician.locator('#notice-body').fill('이 창의 초안');await clinician.locator('#notice-form [type=submit]').click();await clinician.locator('#communication-error:not([hidden])').waitFor();assert.equal(await clinician.locator('#notice-body').inputValue(),'이 창의 초안');
 clinician.once('dialog',d=>d.dismiss());await clinician.locator('#main-nav [data-view=records]').click();assert.equal(new URL(clinician.url()).searchParams.get('view'),'notices');
 clinician.once('dialog',d=>d.accept());await clinician.locator('[data-comm=new-notice]').click();await clinician.locator('[data-comm=reload-notices]').click();await clinician.locator('[data-comm=edit-notice]').first().click();await clinician.locator('#notice-status').selectOption('archived');await clinician.locator('#notice-form [type=submit]').click();await eventually(async()=>!(await(await patient.request.get(base+'/api/notices/active')).json()).notices.length);
 console.log('PASS notice draft/publish/read/edit/archive, escaped rendering, version conflict');
 await clinician.locator('#main-nav [data-view=messages]').click();await clinician.locator('[data-comm=select-conversation][data-id=p001]').click();await clinician.locator('#clinician-message-body').fill('p001 님 전용 안내');
 let loseOnce=true;
 await clinician.route('**/api/patients/p001/messages',async route=>{if(route.request().method()==='POST'&&loseOnce){loseOnce=false;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}else await route.continue();});
 await clinician.locator('#clinician-message-form [type=submit]').click();await clinician.locator('#communication-error:not([hidden])').waitFor();assert.equal(await clinician.locator('#clinician-message-body').inputValue(),'p001 님 전용 안내');
 await clinician.locator('#clinician-message-form [type=submit]').click();await clinician.locator('#clinician-message-list .message-bubble').waitFor();assert.equal((await(await staff.request.get(base+'/api/patients/p001/messages')).json()).messages.length,1);
 await mobile.locator('.bottom-nav [data-view=messages]').click();await mobile.locator('#patient-message-list .message-bubble').waitFor();assert.ok((await mobile.locator('#patient-message-list').innerText()).includes('전용 안내'));
 assert.equal((await(await other.request.get(base+'/api/patients/p002/messages')).json()).messages.length,0);
 await mobile.locator('#patient-message-body').fill('환자 답변');await mobile.locator('#patient-message-send').click();await eventually(async()=>!(await mobile.locator('#patient-message-body').inputValue()));
 await clinician.locator('[data-comm=reload-messages]').click();await eventually(async()=>(await clinician.locator('#clinician-message-list').innerText()).includes('환자 답변'));assert.ok((await clinician.locator('#clinician-message-list').innerText()).includes('읽음'));
 let release;const gate=new Promise(r=>release=r);let started;const waiting=new Promise(r=>started=r);
 await clinician.route('**/api/patients/p001/messages?after=*',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});});
 await clinician.locator('[data-comm=reload-messages]').click();await waiting;await clinician.locator('[data-comm=select-conversation][data-id=p002]').click();release();await clinician.locator('#clinician-message-body').waitFor();await delay(150);assert.equal(await clinician.locator('#clinician-message-list .message-bubble').count(),0);assert.equal(new URL(clinician.url()).searchParams.get('patientId'),'p002');assert.equal(await clinician.locator('.patient-site-link').getAttribute('href'),'/patient?patientId=p002');
 await clinician.unroute('**/api/patients/p001/messages?after=*');await clinician.locator('[data-comm=select-conversation][data-id=p001]').click();
 await mkdir('test-results',{recursive:true});await clinician.screenshot({path:'test-results/clinician-messages-v06.png',fullPage:true});await mobile.screenshot({path:'test-results/patient-messages-v06.png',fullPage:true});
 await clinician.locator('#clinician-message-body').fill('보존할 초안');await clinician.locator('#refresh-button').click();await eventually(async()=>!(await clinician.locator('#refresh-button').isDisabled()));assert.equal(await clinician.locator('#clinician-message-body').inputValue(),'보존할 초안');
 clinician.once('dialog',d=>d.dismiss());await clinician.locator('[data-comm=select-conversation][data-id=p002]').click();assert.equal(new URL(clinician.url()).searchParams.get('patientId'),'p001');
 clinician.once('dialog',d=>d.accept());await clinician.locator('#main-nav [data-view=records]').click();assert.equal(await clinician.locator('#main-nav [data-view=settings]').isHidden(),true);await clinician.locator('#main-nav [data-view=medications]').click();await clinician.goBack();assert.equal(new URL(clinician.url()).searchParams.get('view'),'records');
 await clinician.goBack();await clinician.locator('#clinician-message-body').waitFor();await clinician.locator('#clinician-message-body').fill('뒤로가기 보존');clinician.once('dialog',d=>d.dismiss());await clinician.goBack();await eventually(async()=>new URL(clinician.url()).searchParams.get('view')==='messages');assert.equal(await clinician.locator('#clinician-message-body').inputValue(),'뒤로가기 보존');
 mobile.once('dialog',d=>d.dismiss());await mobile.locator('#patient-message-body').fill('작성 중');await mobile.locator('#patient-view-close').click();assert.equal(new URL(mobile.url()).searchParams.get('view'),'messages');mobile.once('dialog',d=>d.accept());await mobile.locator('#patient-view-close').click();await mobile.locator('#view-home').waitFor({state:'visible'});
 for(const page of [mobile,third])assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log('PASS private messages/replies/read receipts, drafts, navigation, 320/390 layout');
 // Expire only this synthetic account in the temporary SQLite DB; never a public session.
 await mobile.locator('.bottom-nav [data-view=messages]').click();await mobile.locator('#patient-message-body').fill('세션 만료 후 보존할 작성 내용');
 const expiryDb=new DatabaseSync(join(dir,'homecare.sqlite'));
 expiryDb.prepare("UPDATE auth_sessions SET expires_at=0 WHERE account_id IN (SELECT id FROM auth_accounts WHERE provider='kakao' AND provider_user_id='201')").run();expiryDb.close();
 await mobile.locator('#patient-message-send').click();await mobile.locator('#session-recovery').waitFor({state:'visible'});
 assert.equal(await mobile.locator('#patient-message-body').inputValue(),'세션 만료 후 보존할 작성 내용');await mobile.keyboard.press('Escape');assert.equal(await mobile.locator('#session-recovery').isVisible(),true);
 await mobile.getByRole('button',{name:'로그인했어요 · 이어서 작성'}).click();await eventually(async()=>(await mobile.locator('#session-recovery [role=status]').innerText()).includes('일치하지 않습니다'));
 const repeated=await mobile.evaluate(async()=>{const session=await import('/session.js');const response=await fetch('/api/patients/p001/messages');if(response.status===401)session.sessionExpired();let blocked='';try{await session.sessionRequest('/api/patients/p001/messages');}catch(error){blocked=error.message;}return{status:response.status,blocked};});
 assert.equal(repeated.status,401);assert.match(repeated.blocked,/같은 계정/);assert.equal(new URL(mobile.url()).pathname,'/patient');assert.equal(await mobile.locator('#session-recovery').isVisible(),true);assert.equal(await mobile.locator('#patient-message-body').inputValue(),'세션 만료 후 보존할 작성 내용');
 const different=await login(patient,'202','/patient');await different.locator('#app-content:not([hidden])').waitFor();
 await mobile.getByRole('button',{name:'로그인했어요 · 이어서 작성'}).click();await eventually(async()=>(await mobile.locator('#session-recovery [role=status]').innerText()).includes('일치하지 않습니다'));
 assert.equal(await mobile.locator('#patient-message-body').inputValue(),'세션 만료 후 보존할 작성 내용');assert.equal(await mobile.locator('#session-recovery').isVisible(),true);
 const restored=await login(patient,'201','/patient');await restored.locator('#app-content:not([hidden])').waitFor();
 await mobile.getByRole('button',{name:'로그인했어요 · 이어서 작성'}).click();await mobile.locator('#session-recovery').waitFor({state:'detached'});
 assert.equal(await mobile.locator('#patient-message-body').inputValue(),'세션 만료 후 보존할 작성 내용');
 await mobile.locator('#patient-message-send').click();await eventually(async()=>!(await mobile.locator('#patient-message-body').inputValue()));
 assert.ok((await mobile.locator('#patient-message-list').innerText()).includes('세션 만료 후 보존할 작성 내용'));
 await different.close();await restored.close();
 console.log('PASS expired session draft preservation, wrong-account recovery rejection, same-account reauthentication');
 clinician.once('dialog',d=>d.accept());await clinician.locator('#main-nav [data-view=patients]').click();await clinician.locator('[data-action=invitation]').click();await eventually(async()=>(await clinician.locator('#invitation-result').innerText()).startsWith('hci_'));await clinician.locator('#modal [data-modal-action=close]').click();assert.equal(await clinician.locator('#invitation-result').count(),0);
 await mobile.locator('[data-auth-logout]').click();await mobile.waitForURL('**/login?loggedout=1');assert.equal((await patient.request.get(base+'/api/patients/p001/messages')).status(),401);await mobile.goto(base+'/clinician');await mobile.waitForURL('**/login?next=**');
 assert.deepEqual(issues,[]);console.log('PASS invitation modal cleanup, logout revocation and protected direct navigation');
}finally{if(browser)await browser.close();if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});await rm(dir,{recursive:true,force:true});}
