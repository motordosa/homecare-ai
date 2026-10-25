// Real Chromium decoder and HTTP transport; held HTTP responses and missing decoder events are explicit faults.
// Synthetic images only. This does not test a physical iPhone camera, microphone, or HEIC codec.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
let sessionMode = 'normal', postMode = 'normal', hits = 0, closed = 0, count = 0;
const requests = [];
const current = { mode: 'kakao', user: { id: 'synthetic-account', role: 'patient', patientId: 'synthetic-patient' }, csrfToken: 'synthetic-csrf-not-a-secret' };
const html = '<!doctype html><html><body><span data-auth-label></span><button data-auth-logout>로그아웃</button><main id="app-content"></main></body></html>';
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    hits++; requests.push({ path: req.url, method: req.method, csrf: req.headers['x-csrf-token'] });
    res.on('close', () => closed++);
    const mode = req.method === 'POST' ? postMode : sessionMode;
    if (mode === 'hold') return;
    if (mode === 'body') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"mode":'); return; }
    if (mode === 'invalid') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null'); return; }
    if (mode === 'expired') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"로그인이 필요합니다."}'); return; }
    if (mode === 'forbidden') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"error":"요청 확인 정보가 만료되었습니다."}'); return; }
    if (mode === 'error') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"합성 서버 오류"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.method === 'POST' ? {} : current)); return;
  }
  if (['/session.js','/patient-image.js'].includes(req.url)) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(new URL('../public'+req.url,import.meta.url))); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
async function until(fn) { for (let i=0;i<100;i++) { if (fn()) return; await delay(20); } throw Error('Local request did not arrive'); }
async function check(name, fn) { await fn(); count++; console.log('PASS '+name); }
async function start(page, operation) {
  const before = hits;
  await page.evaluate(op => {
    window.__result = null;
    const request = op === 'refresh' ? window.session.refreshSession() : window.session.sessionRequest('/api/auth/demo',{method:'POST',body:'{}'});
    request.then(value => window.__result={ok:true,value}, error => window.__result={ok:false,code:error.code,message:error.message});
  }, operation);
  await until(() => hits > before);
}
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
  const page=await browser.newPage();
  const pageErrors=[]; page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(base); await page.clock.install();
  await page.evaluate(async()=>{window.session=await import('/session.js');window.images=await import('/patient-image.js');});
  await check('session success keeps CSRF and patient identity',async()=>{
    assert.equal(await page.evaluate(()=>session.bootstrapSession('patient')),true);
    assert.deepEqual(await page.evaluate(()=>({mode:session.sessionState.mode,user:session.sessionState.user,csrfToken:session.sessionState.csrfToken})),current);
    await page.evaluate(()=>session.sessionRequest('/api/auth/demo',{method:'POST',body:'{}'}));
    assert.equal(requests.at(-1).csrf,current.csrfToken);
  });
  await check('session response header stall ends at20 seconds and preserves established identity',async()=>{
    sessionMode='hold'; const before=closed;await start(page,'refresh');await page.clock.fastForward(20_001);await page.waitForFunction(()=>window.__result!==null);
    assert.equal((await page.evaluate(()=>window.__result)).code,'session_timeout');await until(()=>closed>before);
    assert.equal(await page.evaluate(()=>session.sessionState.user.patientId),current.user.patientId);
    sessionMode='normal';await page.evaluate(()=>session.refreshSession());
  });
  await check('session body stall is bounded too and POST timeout never fabricates success',async()=>{
    sessionMode='body';await start(page,'refresh');await page.clock.fastForward(20_001);await page.waitForFunction(()=>window.__result!==null);assert.equal((await page.evaluate(()=>__result)).code,'session_timeout');
    sessionMode='normal';postMode='hold';await start(page,'post');await page.clock.fastForward(20_001);await page.waitForFunction(()=>window.__result!==null);assert.equal((await page.evaluate(()=>__result)).code,'session_timeout');postMode='normal';
  });
  await check('explicit abort and malformed responses restore retry without mutating session',async()=>{
    postMode='hold';const before=hits;await page.evaluate(()=>{window.__result=null;window.__cancel=new AbortController();session.sessionRequest('/api/auth/demo',{method:'POST',body:'{}',signal:__cancel.signal}).catch(error=>window.__result={code:error.code});});await until(()=>hits>before);await page.evaluate(()=>__cancel.abort());await page.waitForFunction(()=>__result!==null);assert.equal((await page.evaluate(()=>__result)).code,'session_cancelled');postMode='normal';
    sessionMode='invalid';assert.equal(await page.evaluate(()=>session.refreshSession().then(()=>null,e=>e.code)),'session_response');sessionMode='normal';await page.evaluate(()=>session.refreshSession());assert.equal(await page.evaluate(()=>session.sessionState.user.patientId),current.user.patientId);
  });
  await check('network failure gives a retryable message and successful retry retains CSRF behavior',async()=>{
    await page.route('**/api/auth/session',route=>route.abort('internetdisconnected'));
    assert.equal(await page.evaluate(()=>session.refreshSession().then(()=>null,e=>e.code)),'session_network');
    assert.equal(await page.evaluate(()=>session.sessionState.csrfToken),current.csrfToken);
    await page.unroute('**/api/auth/session');await page.evaluate(()=>session.refreshSession());
  });
  await check('logout CSRF denial remains an error and other401 responses retain session recovery',async()=>{
    postMode='forbidden';assert.match(await page.evaluate(()=>session.sessionRequest('/api/auth/logout',{method:'POST',body:'{}'}).then(()=>'',e=>e.message)),/요청 확인/);
    const recovery=await browser.newPage();await recovery.goto(base);await recovery.evaluate(async()=>{window.session=await import('/session.js');await session.refreshSession();});
    postMode='expired';assert.match(await recovery.evaluate(()=>session.sessionRequest('/api/auth/demo',{method:'POST',body:'{}'}).then(()=>'',e=>e.message)),/로그인/);assert.equal(await recovery.locator('#session-recovery').isVisible(),true);await recovery.close();postMode='normal';
  });
  await check('logout timeout releases the real button and permits explicit retry',async()=>{
    postMode='hold';const before=hits;await page.locator('[data-auth-logout]').click();await until(()=>hits>before);assert.equal(await page.locator('[data-auth-logout]').isDisabled(),true);await page.clock.fastForward(20_001);await page.waitForFunction(()=>!document.querySelector('[data-auth-logout]').disabled);assert.match(await page.locator('[data-auth-label]').innerText(),/다시 시도/);assert.equal(new URL(page.url()).pathname,'/');
    postMode='expired';await page.locator('[data-auth-logout]').click();await page.waitForURL('**/login?loggedout=1');postMode='normal';assert.equal(await page.locator('#session-recovery').count(),0);
    await page.goto(base);await page.evaluate(async()=>{window.images=await import('/patient-image.js');});
  });
  await check('real PNG JPEG WebP decode preserves small original bytes and releases object URLs',async()=>{
    const result=await page.evaluate(async()=>{
      const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);let made=0,released=0;URL.createObjectURL=b=>{made++;return create(b);};URL.revokeObjectURL=u=>{released++;return revoke(u);};
      try { const results=[];for(const type of ['image/png','image/jpeg','image/webp']){const canvas=document.createElement('canvas');canvas.width=3;canvas.height=5;canvas.getContext('2d').fillRect(0,0,3,5);const original=canvas.toDataURL(type);const blob=await(await fetch(original)).blob();const result=await images.preparePatientImage(new File([blob],'synthetic',{type}));results.push({type,same:result.imageData===original,adjusted:result.adjusted});}return{results,made,released}; }
      finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
    });
    assert.ok(result.results.every(r=>r.same&&!r.adjusted));assert.equal(result.made,3);assert.equal(result.released,3);
  });
  await check('corrupt small PNG and mismatched MIME cannot become ready',async()=>{
    const errors=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const png=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const files=[new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0])],'broken.png',{type:'image/png'}),new File([png],'mismatch.jpg',{type:'image/jpeg'}),new File([],'empty.png',{type:'image/png'}),new File(['<svg/>'],'not-a-photo.svg',{type:'image/svg+xml'})];
      return Promise.all(files.map(file=>images.preparePatientImage(file).then(()=>null,e=>e.message)));
    });assert.ok(errors.every(Boolean));assert.match(errors[0],/사진을 열지 못/);assert.match(errors[1],/사진 형식/);
  });
  await check('real oversized zero and malformed PNG JPEG WebP headers are rejected before creating a decoder',async()=>{
    const result=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const fixtures=[];
      const bytesOf=async type=>new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,type))).arrayBuffer());
      const png=await bytesOf('image/png');
      for(const [name,width,height] of [['huge',9000,9000],['zero',0,2]]){const bytes=png.slice();const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);fixtures.push({name:'png-'+name,type:'image/png',bytes});}
      fixtures.push({name:'png-truncated',type:'image/png',bytes:png.slice(0,22)});
      const jpeg=await bytesOf('image/jpeg');let offset=2;
      while(jpeg[offset]===255&&!([0xc0,0xc1,0xc2].includes(jpeg[offset+1])))offset+=2+(jpeg[offset+2]*256+jpeg[offset+3]);
      if(jpeg[offset]!==255)throw Error('synthetic JPEG has no SOF');
      for(const [name,width,height] of [['huge',60000,60000],['zero',0,2]]){const bytes=jpeg.slice();const view=new DataView(bytes.buffer);view.setUint16(offset+5,height);view.setUint16(offset+7,width);fixtures.push({name:'jpeg-'+name,type:'image/jpeg',bytes});}
      const short=jpeg.slice();short[offset+2]=short[offset+3]=0;fixtures.push({name:'jpeg-invalid-length',type:'image/jpeg',bytes:short});
      const webp=(kind,data)=>{const bytes=new Uint8Array(20+data.length+(data.length&1)),view=new DataView(bytes.buffer);bytes.set([82,73,70,70]);view.setUint32(4,bytes.length-8,true);bytes.set([87,69,66,80],8);bytes.set([...kind].map(c=>c.charCodeAt(0)),12);view.setUint32(16,data.length,true);bytes.set(data,20);return bytes;};
      for(const [name,width,height] of [['huge',16383,16383],['zero',0,2]]){const data=new Uint8Array([0,0,0,157,1,42,0,0,0,0]);const view=new DataView(data.buffer);view.setUint16(6,width,true);view.setUint16(8,height,true);fixtures.push({name:'webp-vp8-'+name,type:'image/webp',bytes:webp('VP8 ',data)});}
      const lossless=new Uint8Array(5);lossless[0]=47;new DataView(lossless.buffer).setUint32(1,(16383|(16383<<14))>>>0,true);fixtures.push({name:'webp-vp8l-huge',type:'image/webp',bytes:webp('VP8L',lossless)});
      const extended=new Uint8Array(10);for(const start of [4,7]){extended[start]=8999&255;extended[start+1]=(8999>>8)&255;}fixtures.push({name:'webp-vp8x-huge',type:'image/webp',bytes:webp('VP8X',extended)});
      const malformed=webp('VP8 ',new Uint8Array(10));new DataView(malformed.buffer).setUint32(16,100000,true);fixtures.push({name:'webp-truncated-chunk',type:'image/webp',bytes:malformed});
      const metadata=new Uint8Array(65537);metadata.set([255,225,255,255]);fixtures.push({name:'jpeg-sof-beyond1MiB',type:'image/jpeg',bytes:new Blob([jpeg.slice(0,2),...Array(17).fill(metadata),jpeg.slice(2)])});
      const Original=window.Image,create=URL.createObjectURL.bind(URL);let images=0,urls=0;
      window.Image=class{constructor(){images++;throw Error('decoder must not be reached');}};URL.createObjectURL=value=>{urls++;return create(value);};
      try {const outcomes=[];for(const fixture of fixtures){const error=await window.images.preparePatientImage(new File([fixture.bytes],fixture.name,{type:fixture.type})).then(()=>null,e=>e.message);outcomes.push({name:fixture.name,error});}return{outcomes,images,urls};}
      finally{window.Image=Original;URL.createObjectURL=create;}
    });assert.equal(result.outcomes.length,12);assert.ok(result.outcomes.every(r=>r.error&&/사진 크기 정보/.test(r.error)),JSON.stringify(result.outcomes));assert.equal(result.images,0);assert.equal(result.urls,0);
  });
  await check('oversized supported image is converted after decode within upload and dimension limits',async()=>{
    const result=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;canvas.getContext('2d').fillRect(0,0,2400,1200);const png=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const file=new File([png,new Uint8Array(5*1024*1024)],'large-synthetic.png',{type:'image/png'});const ready=await images.preparePatientImage(file);const blob=await(await fetch(ready.imageData)).blob();const img=new Image();img.src=ready.imageData;await img.decode();return{adjusted:ready.adjusted,type:blob.type,size:blob.size,width:img.naturalWidth,height:img.naturalHeight};
    });assert.equal(result.adjusted,true);assert.equal(result.type,'image/jpeg');assert.ok(result.size<=5*1024*1024);assert.equal(result.width,2048);assert.equal(result.height,1024);
  });
  await check('real EXIF orientation survives JPEG conversion',async()=>{
    const result=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=3;canvas.height=5;canvas.getContext('2d').fillRect(0,0,3,5);const jpeg=await new Promise(r=>canvas.toBlob(r,'image/jpeg'));const bytes=new Uint8Array(await jpeg.arrayBuffer());
      const segment=new Uint8Array(36);segment.set([255,225,0,34,69,120,105,102,0,0,73,73]);const view=new DataView(segment.buffer);view.setUint16(12,42,true);view.setUint32(14,8,true);view.setUint16(18,1,true);view.setUint16(20,0x112,true);view.setUint16(22,3,true);view.setUint32(24,1,true);view.setUint16(28,6,true);
      const file=new File([bytes.slice(0,2),segment,bytes.slice(2),new Uint8Array(5*1024*1024)],'exif-synthetic.jpg',{type:'image/jpeg'});const ready=await images.preparePatientImage(file);const image=new Image();image.src=ready.imageData;await image.decode();return{adjusted:ready.adjusted,width:image.naturalWidth,height:image.naturalHeight};
    });assert.equal(result.adjusted,true);assert.equal(result.width,5);assert.equal(result.height,3);
  });
  await check('MOCK decoded dimensions above80MP are rejected and image URL is released',async()=>{
    const result=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const png=await new Promise(r=>canvas.toBlob(r,'image/png'));const Original=window.Image,revoke=URL.revokeObjectURL.bind(URL);let released=0;
      window.Image=class{naturalWidth=9000;naturalHeight=9000;removeAttribute(){}set src(value){queueMicrotask(()=>this.onload?.());}};URL.revokeObjectURL=url=>{released++;revoke(url);};
      try {const error=await images.preparePatientImage(new File([png],'synthetic.png',{type:'image/png'})).then(()=>null,e=>e.message);return{error,released};}finally{window.Image=Original;URL.revokeObjectURL=revoke;}
    });assert.match(result.error,/사진을 열지 못/);assert.equal(result.released,1);
  });
  await check('MOCK missing decoder events are bounded and release URL without claiming ready',async()=>{
    await page.clock.install();
    await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const png=await new Promise(r=>canvas.toBlob(r,'image/png'));window.__originalImage=window.Image;window.__originalRevoke=URL.revokeObjectURL;window.__revoked=0;window.__decodeStarted=false;window.Image=class{removeAttribute(){}set src(value){window.__decodeStarted=true;}};URL.revokeObjectURL=url=>{__revoked++;__originalRevoke(url);};window.__result=null;images.preparePatientImage(new File([png],'synthetic.png',{type:'image/png'})).then(()=>__result={ok:true},e=>__result={ok:false,message:e.message});
    });
    // Header arrayBuffer and object URL creation must precede the virtual deadline.
    await page.waitForFunction(()=>window.__decodeStarted);
    await page.clock.fastForward(15_001);await page.waitForFunction(()=>__result!==null);assert.equal((await page.evaluate(()=>__result)).ok,false);assert.equal(await page.evaluate(()=>__revoked),1);await page.evaluate(()=>{window.Image=__originalImage;URL.revokeObjectURL=__originalRevoke;});
  });
  await check('MOCK missing file read events are bounded and the reader is aborted',async()=>{
    await page.evaluate(()=>{
      window.__originalReader=window.FileReader;window.__readStarted=false;window.__readAborted=false;
      window.FileReader=class{readAsArrayBuffer(){__readStarted=true;}abort(){__readAborted=true;}};
      window.__result=null;images.preparePatientImage(new File(['synthetic'],'synthetic.png',{type:'image/png'})).then(()=>__result={ok:true},e=>__result={ok:false,message:e.message});
    });await page.waitForFunction(()=>__readStarted);await page.clock.fastForward(15_001);await page.waitForFunction(()=>__result!==null);assert.equal((await page.evaluate(()=>__result)).ok,false);assert.equal(await page.evaluate(()=>__readAborted),true);await page.evaluate(()=>window.FileReader=__originalReader);
  });
  assert.deepEqual(pageErrors,[]);console.log(`${count} client IO reliability scenarios passed; physical iPhone camera/HEIC and microphone unverified.`);
} finally { await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
