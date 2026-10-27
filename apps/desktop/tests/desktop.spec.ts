import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

// Every scenario has a fresh database, encrypted settings and Chromium profile.
test.beforeEach(()=>{process.env.HARMONY_TEST_PROFILE='test-'+randomUUID().replaceAll('-','');});
test.afterEach(()=>{delete process.env.HARMONY_TEST_PROFILE;});

test('desktop reports real core state, verifies health, stops, resumes, and stays sandboxed', async () => {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [resolve('.')], env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if(message.type()==='error' && /shader error|validate_status|compilation failed/i.test(message.text())) errors.push(message.text()); });
    await expect(page.getByText('LOCAL CORE CONNECTED')).toBeVisible();
    await expect(page.getByText('STANDING BY', { exact: true })).toBeVisible();
    await expect(page.locator('.presence canvas')).toBeVisible({ timeout: 15000 });
    const state = await page.evaluate(() => window.harmony!.snapshot());
    expect({ system: state.system, voice: state.voice, identity: state.identity, conversation: state.conversation, focus: state.focus }).toEqual({ system: 'PASSIVE', voice: 'DISABLED', identity: 'UNKNOWN', conversation: 'NONE', focus: 'NORMAL' });
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (window as any).process)).toBe('undefined');
    expect(await page.evaluate(() => Object.keys((window as any).harmony).sort())).toEqual(['allowanceApprove', 'allowanceCancel', 'allowanceReview', 'audioPush', 'audioStart', 'audioStop', 'check', 'chooseFileRoot', 'fileRoot', 'floatDesktop', 'forgetFileRoot', 'inspectComputer', 'localVoiceAvailable', 'localVoicePrepare', 'localVoicePreview', 'ownerEnroll', 'ownerStatus', 'previewFile', 'reasoningApprove', 'reasoningCancel', 'reasoningConfigure', 'reasoningConnection', 'reasoningForget', 'reasoningReview', 'resume', 'showChamber', 'snapshot', 'stop', 'subscribe', 'voiceConfigure', 'voiceConnection', 'voiceForget', 'voiceNext', 'voicePlayback', 'voicePreview', 'voiceStop', 'wakeStart']);
    await page.getByRole('button', { name: 'Run local check' }).click();
    await expect(page.getByText(/Last check passed ·/)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await expect(page.getByText('Startup, response and shutdown verified.')).toBeVisible();
    await page.getByRole('button',{name:'Inspect this computer'}).click();
    await expect(page.getByRole('definition').filter({hasText:'GiB'})).toBeVisible();
    expect((await page.evaluate(()=>window.harmony!.snapshot())).identity).toBe('UNKNOWN');
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await page.getByText('Developer latency profiler',{exact:true}).click();
    await expect(page.locator('.latency-profiler dt')).toHaveCount(12);
    await expect(page.getByText('tool · completed',{exact:true})).toBeVisible();
    expect((await page.evaluate(()=>window.harmony!.snapshot())).latency?.metrics.tool_complete_ms.state).toBe('completed');
    await page.locator('.latency-profiler dt').last().scrollIntoViewIfNeeded();
    await expect(page.getByText('full_turn_ms',{exact:true})).toBeVisible();
    await page.screenshot({path:'docs/latency-profiler-preview.png'});
    const checked = await page.evaluate(() => window.harmony!.snapshot());
    const healthStart = checked.events.find(event => event.type === 'HEALTH_STARTED')!;
    const healthEnd = checked.events.find(event => event.type === 'HEALTH_PASSED')!;
    expect(healthStart.turnId).toBeTruthy();
    expect(healthEnd.turnId).toBe(healthStart.turnId);
    expect(healthEnd.monotonicMs).toBeGreaterThanOrEqual(healthStart.monotonicMs);
    expect(checked.eventDiagnostics).toEqual({ observerFailures: 0, droppedEvents: 0 });
    expect(checked.events.every(event => !Object.hasOwn(event, 'payload'))).toBe(true);
    await page.getByRole('button', { name: 'Stop all work' }).click();
    await expect(page.getByText('STOPPED', { exact: true })).toBeVisible();
    await expect(page.getByText('Work stopped', { exact: true })).toBeVisible();
    const stopped = await page.evaluate(() => window.harmony!.snapshot());
    expect(stopped.events.find(event => event.type === 'STOP_REQUESTED')!.generation).toBeGreaterThan(healthStart.generation);
    expect({ voice: stopped.voice, identity: stopped.identity, conversation: stopped.conversation }).toEqual({ voice: 'DISABLED', identity: 'UNKNOWN', conversation: 'NONE' });
    await page.getByRole('button', { name: 'Resume HARMONY' }).click();
    await expect(page.getByText('STANDING BY', { exact: true })).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.presence')).toHaveAttribute('data-motion', 'still');
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Recent runtime events' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Recent runtime events' })).toBeVisible();
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await expect(page.getByRole('list', { name: 'Recent runtime events' })).toHaveCount(0);
    await page.getByLabel('Local command', { exact: true }).fill('/status');
    await page.getByLabel('Local command', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'What’s online' })).toBeVisible();
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('checkbox', { name: /Calm visuals/ }).check();
    await expect(page.locator('.presence')).toHaveAttribute('data-motion', 'still');
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeFocused();
    await page.screenshot({ path: 'docs/desktop-preview.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'docs/desktop-narrow-preview.png', fullPage: true });
    await page.locator('.presence canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    await expect(page.getByTestId('presence-fallback')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run local check' })).toBeEnabled();
    await page.reload();
    await expect(page.getByText('STANDING BY', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});


test('local audio uses an explicit grant, synthetic capture, and STOP releases every track', async()=>{
  test.setTimeout(60000);
  const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[resolve('.'),'--use-fake-device-for-media-stream'],env});
  try{
    const page=await app.firstWindow();
    await expect(page.getByText('LOCAL CORE CONNECTED')).toBeVisible();
    expect(await page.evaluate(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop());return 'granted';}catch{return 'denied';}})).toBe('denied');
    await page.evaluate(()=>{
      const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);(window as any).testTracks=stream.getTracks();return stream;};
    });
    await page.getByRole('button',{name:'Open settings'}).click();
    await page.getByRole('button',{name:'Start microphone test'}).click();
    await expect(page.getByText('MICROPHONE ON · LOCAL TEST',{exact:false})).toBeVisible({timeout:45000});
    const active=await page.evaluate(()=>window.harmony!.snapshot());
    expect(active.audio.receivedFrames).toBeGreaterThan(0);
    expect(active.voice).toBe('DISABLED');expect(active.identity).toBe('UNKNOWN');
    expect(await page.evaluate(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({video:true});stream.getTracks().forEach(track=>track.stop());return 'granted';}catch{return 'denied';}})).toBe('denied');
    await page.getByRole('button',{name:'Stop all work'}).click();
    await expect(page.getByText('MICROPHONE OFF',{exact:false})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>(window as any).testTracks.every((track:MediaStreamTrack)=>track.readyState==='ended'))).toBe(true);
    await expect.poll(async()=> (await page.evaluate(()=>window.harmony!.snapshot())).audio.state).toBe('OFF');
    await page.reload();
    await expect(page.getByText('MICROPHONE OFF',{exact:false})).toBeVisible();
  }finally{await app.close();}
});

test('transparent companion shares STOP, denies audio ownership and returns to chamber', async () => {
  const env: Record<string,string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({args:[resolve('.')],env});
  try {
    const chamber = await app.firstWindow();
    await expect(chamber.getByText('LOCAL CORE CONNECTED')).toBeVisible();
    const opened=app.waitForEvent('window');
    await chamber.getByRole('button',{name:'Float on desktop'}).click();
    const floating=await opened;
    await expect(floating.getByText('Standing by',{exact:true})).toBeVisible();
    await expect(floating.locator('.presence canvas')).toBeVisible();
    expect(await floating.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const properties=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),visible:w.isVisible(),top:w.isAlwaysOnTop(),size:w.getSize()})));
    expect(properties.find(w=>w.title==='HARMONY companion')).toMatchObject({visible:true,top:true});
    expect(properties.find(w=>w.title!=='HARMONY companion')?.visible).toBe(false);
    const viewport=await floating.evaluate(()=>({width:innerWidth,height:innerHeight}));
    expect(viewport.width).toBeGreaterThanOrEqual(330); expect(viewport.height).toBeGreaterThanOrEqual(390);
    expect(await floating.evaluate(()=>window.harmony!.audioStart().then(()=>false,()=>true))).toBe(true);
    await floating.getByRole('button',{name:'STOP'}).click();
    await expect(floating.getByText('Work stopped',{exact:true})).toBeVisible();
    expect((await chamber.evaluate(()=>window.harmony!.snapshot())).system).toBe('STOPPED');
    await floating.getByRole('button',{name:'Resume HARMONY',exact:true}).click();
    await expect(floating.getByText('Standing by',{exact:true})).toBeVisible();
    await floating.emulateMedia({reducedMotion:'reduce'});
    await expect(floating.locator('.presence')).toHaveAttribute('data-motion','still');
    await floating.screenshot({path:'docs/desktop-companion-preview.png',omitBackground:true});
    await floating.getByRole('button',{name:'Open chamber'}).click();
    await expect.poll(()=>app.windows().length).toBe(1);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await expect(chamber.getByText('STANDING BY',{exact:true})).toBeVisible();
  } finally {await app.close();}
});


test('Windows protected storage encrypts and decrypts a disposable fixture',async()=>{
  const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[resolve('.')],env});
  try{
    await app.firstWindow();
    const result=await app.evaluate(async({safeStorage})=>{
      const available=await safeStorage.isAsyncEncryptionAvailable();
      if(!available)return {available,roundtrip:false,opaque:false};
      const value='HARMONY disposable encryption fixture';
      const encrypted=await safeStorage.encryptStringAsync(value);
      const decoded=await safeStorage.decryptStringAsync(encrypted);
      return {available,roundtrip:decoded.result===value,opaque:!encrypted.includes(Buffer.from(value))};
    });
    expect(result).toEqual({available:true,roundtrip:true,opaque:true});
  }finally{await app.close();}
});

test('streamed voice playback completes and stops from the companion using synthetic PCM',async()=>{
  test.setTimeout(90000);

  const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
  try{
    const chamber=await app.firstWindow();
    // Renderer integration fixture only; production worker/credential policy has separate tests.
    await app.evaluate(async({ipcMain,BrowserWindow})=>{
      const chamber=BrowserWindow.getAllWindows()[0];
      let snapshot=await chamber.webContents.executeJavaScript('window.harmony.snapshot()');let index=0;
      const publish=(patch:Record<string,unknown>)=>{snapshot={...snapshot,...patch,revision:snapshot.revision+1};for(const window of BrowserWindow.getAllWindows())window.webContents.send('harmony:state',snapshot);};
      const replace=(name:string,handler:(...args:any[])=>any)=>{ipcMain.removeHandler('harmony:'+name);ipcMain.handle('harmony:'+name,handler);};
      replace('snapshot',()=>snapshot);
      replace('voice-connection',()=>({configured:true,region:'fixture',voice:'en-AU-NatashaNeural'}));
      replace('voice-preview',(event,_preset,approved)=>{if(event.sender.id!==chamber.webContents.id||approved!==true)throw new Error('Denied');index=0;publish({speechOutput:{state:'STARTING',preset:'natural',tts_first_audio_ms:null,playback_start_ms:null,error:null}});return {sessionId:'fixture-session'};});
      replace('voice-next',async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {done:index++>=30,rate:24000,samples:new Int16Array(2400).fill(100)};});
      replace('voice-playback',(_event,_id,finished)=>publish({speechOutput:{state:finished?'FINISHED':'PLAYING',preset:'natural',tts_first_audio_ms:20,playback_start_ms:40,error:null}}));
      replace('voice-stop',()=>publish({speechOutput:{...snapshot.speechOutput,state:'CANCELLED'}}));
      replace('stop',()=>publish({system:'STOPPED',stopping:false,speechOutput:{...snapshot.speechOutput,state:'CANCELLED'}}));
      replace('resume',()=>publish({system:'PASSIVE',stopping:false}));
    });
    await chamber.evaluate(()=>{const Original=window.AudioContext;(window as any).__voiceContexts=[];window.AudioContext=class extends Original{constructor(options?:AudioContextOptions){super(options);(window as any).__voiceContexts.push(this);}};});
    await chamber.getByRole('button',{name:'Open settings'}).click();
    await chamber.getByRole('checkbox',{name:/I approve this fixed/}).check();
    await chamber.getByRole('button',{name:'Hear HARMONY'}).click();
    await expect(chamber.getByText('Playing voice preview',{exact:true})).toBeVisible({timeout:25000});
    const speaking=await chamber.evaluate(()=>window.harmony!.snapshot());
    expect(speaking.identity).toBe('UNKNOWN');expect(speaking.voice).toBe('DISABLED');

    await expect(chamber.locator('.presence')).toHaveAttribute('data-mode','speaking');
    await expect(chamber.getByText('Preview finished',{exact:true})).toBeVisible({timeout:35000});
    await chamber.locator('#voice-pacing').selectOption('relaxed');
    await chamber.getByRole('checkbox',{name:/I approve this fixed/}).check();
    await chamber.getByRole('button',{name:'Hear HARMONY'}).click();
    await expect(chamber.getByText('Playing voice preview',{exact:true})).toBeVisible({timeout:25000});
    const opened=app.waitForEvent('window');await chamber.getByRole('button',{name:'Float on desktop'}).click();const floating=await opened;
    await expect(floating.getByText('Voice preview',{exact:true})).toBeVisible();
    expect(await floating.evaluate(()=>window.harmony!.voicePreview('natural',true).then(()=>false,()=>true))).toBe(true);
    await floating.getByRole('button',{name:'STOP'}).click();
    await expect(floating.getByText('Work stopped',{exact:true})).toBeVisible();
    await expect.poll(()=>chamber.evaluate(()=>(window as any).__voiceContexts.every((context:AudioContext)=>context.state==='closed'))).toBe(true);

    await floating.getByRole('button',{name:'Open chamber'}).click();
    await chamber.getByRole('button',{name:'Resume HARMONY'}).click();
    await expect(chamber.getByText('STANDING BY',{exact:true})).toBeVisible();
    await expect(chamber.getByRole('alert')).toHaveCount(0);
    await chamber.getByRole('button',{name:'Hear HARMONY'}).scrollIntoViewIfNeeded();
    await chamber.screenshot({path:'docs/australian-voice-preview.png'});
  }finally{await app.close();}
});

test('real voice IPC requires approval and protects connection metadata',async()=>{
  const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
  try{
    const chamber=await app.firstWindow();
    const status=await chamber.evaluate(()=>window.harmony!.voiceConnection());
    expect(Object.keys(status).sort()).toEqual(['configured','region','voice']);
    expect(await chamber.evaluate(()=>window.harmony!.voicePreview('natural',false).then(()=>false,()=>true))).toBe(true);
    await chamber.getByRole('button',{name:'Open settings'}).click();
    await expect(chamber.getByRole('button',{name:'Hear HARMONY'})).toBeDisabled();
    await expect(chamber.getByRole('button',{name:'Start microphone test'})).toBeEnabled();
    await expect(chamber.getByRole('checkbox',{name:/I approve this fixed/})).toHaveCount(1);
    if(!status.configured){
      expect(await chamber.evaluate(()=>window.harmony!.voicePreview('natural',true).then(()=>false,()=>true))).toBe(true);
      await expect(chamber.getByLabel('Azure Speech key')).toBeVisible();
      await chamber.screenshot({path:'docs/australian-voice-setup.png'});
    }
    expect((await chamber.evaluate(()=>window.harmony!.snapshot())).audio.state).toBe('OFF');
  }finally{await app.close();}
});


test('selected folder preview renders text inertly and STOP revokes access',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(resolve(tmpdir(),'harmony-preview-'));
 const content='<script>window.__fileExecuted=true</script>';
 await writeFile(resolve(dir,'fixture.txt'),content);
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();
  expect(await page.evaluate(()=>window.harmony!.fileRoot())).toBeNull();
  expect(await page.evaluate(()=>window.harmony!.previewFile('fixture.txt').then(()=>false,()=>true))).toBe(true);
  await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[root]})) as typeof dialog.showOpenDialog;},dir);
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('button',{name:'Choose folder',exact:true}).click();
  await page.getByLabel('File inside selected folder').fill('fixture.txt');
  await page.getByRole('button',{name:'Preview text',exact:true}).click();
  await expect(page.getByLabel('Local file preview')).toHaveText(content);
  expect(await page.evaluate(()=>(window as any).__fileExecuted)).toBeUndefined();
  await page.getByLabel('File inside selected folder').fill('../outside.txt');
  await page.getByRole('button',{name:'Preview text',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Cannot preview');
  await page.getByRole('button',{name:'Stop all work',exact:true}).click();
  await expect(page.getByLabel('Local file preview')).toHaveCount(0);
  expect(await page.evaluate(()=>window.harmony!.fileRoot())).toBeNull();
  await page.getByRole('button',{name:'Resume HARMONY'}).click();
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  expect(await page.evaluate(()=>window.harmony!.previewFile('fixture.txt').then(()=>false,()=>true))).toBe(true);
  await page.getByRole('button',{name:'Choose folder',exact:true}).click();
  await page.getByLabel('File inside selected folder').fill('fixture.txt');
  await page.getByRole('button',{name:'Preview text',exact:true}).click();
  await expect(page.getByLabel('Local file preview')).toHaveText(content);
  await page.screenshot({path:'docs/file-preview.png'});
  await page.reload();
  expect(await page.evaluate(()=>window.harmony!.fileRoot())).toBeNull();
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});


test('Escape stops real local voice warmup and works from the floating companion',async()=>{
 test.setTimeout(45000);
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();const installed=await page.evaluate(()=>window.harmony!.localVoiceAvailable());
  await page.getByRole('button',{name:'Open settings'}).click();
  if(installed){
   await page.getByRole('button',{name:'Prepare local voice silently'}).click();
   await expect.poll(()=>page.evaluate(async()=>(await window.harmony!.snapshot()).speechOutput?.state)).toBe('PREPARING');
   await expect(page.locator('.presence')).toHaveAttribute('data-budget','processing');
  }else await expect(page.getByRole('button',{name:'Hear British local test'})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByText('STOPPED',{exact:true})).toBeVisible();
  await expect(page.locator('.presence')).toHaveAttribute('data-budget','normal');
  expect((await page.evaluate(()=>window.harmony!.snapshot())).audio.state).toBe('OFF');
  await page.getByRole('button',{name:'Resume HARMONY'}).click();
  const opened=app.waitForEvent('window');await page.getByRole('button',{name:'Float on desktop'}).click();const companion=await opened;
  await expect(companion.getByText('Standing by',{exact:true})).toBeVisible();
  expect(await companion.evaluate(()=>window.harmony!.localVoicePreview().then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.localVoicePrepare().then(()=>false,()=>true))).toBe(true);
  await companion.keyboard.press('Escape');await expect(companion.getByText('Work stopped',{exact:true})).toBeVisible();
 }finally{await app.close();}
});


for(const engine of ['kokoro','piper'] as const){
test(`installed local voice ${engine} prepares silently and completes a muted fixed audition`,async()=>{
 test.setTimeout(120000);
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 const diagnostics:string[]=[];app.process().stderr?.on('data',data=>{if(diagnostics.length<30)diagnostics.push(String(data).slice(0,2000));});app.process().on('exit',(code,signal)=>diagnostics.push(`exit ${code} ${signal}`));
 try{
  const page=await app.firstWindow();test.skip(!(await page.evaluate(engine=>window.harmony!.localVoiceAvailable(engine),engine)),'Optional local model is not provisioned');
  await page.evaluate(()=>{
   const stats={chunks:0,maxScheduledGapMs:0,lastEnd:0};(window as any).__localTiming=stats;
   const start=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(when=0,offset=0,duration?:number){
    if(stats.chunks)stats.maxScheduledGapMs=Math.max(stats.maxScheduledGapMs,Math.max(0,when-stats.lastEnd)*1000);
    stats.chunks++;stats.lastEnd=when+(duration??this.buffer?.duration??0);start.call(this,when,offset,duration);
   };
  });
  const preference=(await page.evaluate(()=>window.harmony!.snapshot())).voicePreference;
  await page.getByRole('button',{name:'Open settings'}).click();
  await page.getByLabel('Local test voice',{exact:true}).selectOption(engine);
  await expect(page.getByLabel('Local test voice',{exact:true})).toHaveValue(engine);
  expect(await page.evaluate(()=>window.harmony!.localVoicePreview('unknown' as any).then(()=>false,()=>true))).toBe(true);
  const preparationStarted=Date.now();
  await page.getByRole('button',{name:'Prepare local voice silently'}).click();
  await expect.poll(()=>page.evaluate(async()=>(await window.harmony!.snapshot()).speechOutput?.state),{timeout:75000}).not.toBe('PREPARING');
  const preparationMs=Date.now()-preparationStarted;
  const prepared=await page.evaluate(()=>window.harmony!.snapshot());
  await test.info().attach('preparation-status',{body:JSON.stringify({engine,preparationMs,output:prepared.speechOutput}),contentType:'application/json'});
  expect(prepared.speechOutput?.state,JSON.stringify(prepared.speechOutput)).toBe('READY');expect(prepared.speechOutput?.tts_first_audio_ms).toBeNull();expect(prepared.audio.state).toBe('OFF');
  expect(await page.evaluate(()=>(window as any).__localTiming.chunks)).toBe(0);

  await page.getByRole('button',{name:'Hear British local test'}).click();
  await expect.poll(()=>page.evaluate(async()=>(await window.harmony!.snapshot()).speechOutput?.state),{timeout:90000}).toBe('FINISHED');
  const result=await page.evaluate(()=>window.harmony!.snapshot());
  expect(result.speechOutput?.provider).toBe('local');expect(result.speechOutput?.localEngine).toBe(engine);expect(result.speechOutput?.tts_first_audio_ms).toBeGreaterThan(0);expect(result.audio.state).toBe('OFF');expect(result.voicePreference).toBe(preference);expect(result.identity).toBe('UNKNOWN');
  const scheduled=await page.evaluate(()=>(window as any).__localTiming as {chunks:number;maxScheduledGapMs:number});
  expect(scheduled.chunks).toBeGreaterThan(1);
  const {writeFile}=await import('node:fs/promises');
  await writeFile(`docs/local-voice-${engine}-desktop-profile.json`,JSON.stringify({provider:engine,preparationStages:prepared.speechOutput?.preparation??[],locale:'en-GB',muted:true,microphoneUsed:false,firstPcmMs:result.speechOutput!.tts_first_audio_ms,playbackReportedMs:result.speechOutput!.playback_start_ms,fullPreviewMs:result.latency!.metrics.full_turn_ms.ms,chunks:scheduled.chunks,maxScheduledGapMs:Math.round(scheduled.maxScheduledGapMs*100)/100,lookaheadFrames:60,processingVisualBudget:true,preparationMs,preparedBeforePlayback:true,sentenceFraming:true,acousticMeasurement:false},null,2)+'\n');
  await page.getByRole('heading',{name:'British female · offline test'}).scrollIntoViewIfNeeded();await page.screenshot({path:`docs/local-voice-${engine}-audition.png`});
  await page.keyboard.press('Escape');await expect(page.getByText('STOPPED',{exact:true})).toBeVisible();
 }catch(error){await test.info().attach('local-desktop-diagnostics',{body:diagnostics.join('\n'),contentType:'text/plain'});throw error;}finally{await app.close();}
});

}


test('OpenAI setup saves only protected local credentials and denies companion access',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});let saved=false;
 try{
  const page=await app.firstWindow();const initial=await page.evaluate(()=>window.harmony!.reasoningConnection());
  test.skip(initial.configured,'Preserve existing user credentials');
  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  const input=page.getByLabel('OpenAI API key');await expect(input).toHaveAttribute('type','password');
  await input.fill('fixture_not_a_real_openai_key');saved=true;await page.getByRole('button',{name:'Save OpenAI key locally'}).click();
  await expect(page.getByText('Key saved on this computer. No request was sent.')).toBeVisible();saved=true;
  expect(await input.inputValue()).toBe('');
  expect(await page.evaluate(()=>window.harmony!.reasoningConnection())).toEqual({configured:true,model:'gpt-6-astra',verified:false});
  const bytes=await readFile(resolve('data','test-profiles',process.env.HARMONY_TEST_PROFILE!,'credentials','reasoning.enc'));const protectedBytes={length:bytes.length,containsFixture:bytes.includes(Buffer.from('fixture_not_a_real_openai_key'))};
  expect(protectedBytes.length).toBeGreaterThan(0);expect(protectedBytes.containsFixture).toBe(false);
  expect(JSON.stringify(await page.evaluate(()=>window.harmony!.snapshot()))).not.toContain('fixture_not_a_real_openai_key');
  await page.getByRole('heading',{name:'AI reasoning connection'}).scrollIntoViewIfNeeded();await page.screenshot({path:'docs/reasoning-setup-preview.png'});
  expect(await page.evaluate(()=>window.harmony!.reasoningConfigure({key:'fixture_not_a_real_openai_key',endpoint:'https://elsewhere.test'} as any).then(()=>false,()=>true))).toBe(true);
  const opened=app.waitForEvent('window');await page.getByRole('button',{name:'Float on desktop'}).click();const companion=await opened;
  await expect(companion.getByText('Standing by',{exact:true})).toBeVisible();
  expect(await companion.evaluate(()=>window.harmony!.reasoningConnection().then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.reasoningConfigure({key:'fixture_not_a_real_openai_key'}).then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.reasoningForget().then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.reasoningReview('not allowed').then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.reasoningApprove('not allowed').then(()=>false,()=>true))).toBe(true);
  await companion.getByRole('button',{name:'Open chamber'}).click();
  await page.getByRole('button',{name:'System',exact:true}).click();
  await page.getByLabel('Your request to HARMONY').fill('A local review fixture. Do not send.');
  await page.getByRole('button',{name:'Review cloud request'}).click();
  await expect(page.getByRole('heading',{name:'Review before estimating'})).toBeVisible();
  const reviewId=(await page.evaluate(()=>window.harmony!.snapshot())).reasoning!.reviewId!;
  expect(await page.evaluate(()=>window.harmony!.reasoningApprove('wrong-review-id').then(()=>false,()=>true))).toBe(true);
  await page.getByRole('button',{name:'Send for cost estimate'}).scrollIntoViewIfNeeded();await page.screenshot({path:'docs/reasoning-review-preview.png'});
  await page.getByRole('button',{name:'Stop all work'}).click();await expect(page.getByText('STOPPED',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Resume HARMONY'}).click();
  expect(await page.evaluate(id=>window.harmony!.reasoningApprove(id).then(()=>false,()=>true),reviewId)).toBe(true);
  await page.getByRole('button',{name:'Open settings'}).click();
  await page.getByRole('button',{name:'Remove saved OpenAI key'}).click();await expect(page.getByText('Saved OpenAI key removed.')).toBeVisible();saved=false;
  expect((await page.evaluate(()=>window.harmony!.reasoningConnection())).configured).toBe(false);
 }finally{if(saved){const page=app.windows().find(w=>!w.url().endsWith('#companion'));await page?.evaluate(()=>window.harmony!.reasoningForget());}await app.close();}
});


test('reasoning panel streams inert text and reports completion using an offline UI fixture',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();
  await app.evaluate(async({ipcMain,BrowserWindow})=>{
   const chamber=BrowserWindow.getAllWindows()[0];let snapshot=await chamber.webContents.executeJavaScript('window.harmony.snapshot()');
   const publish=(patch:Record<string,unknown>)=>{snapshot={...snapshot,...patch,revision:snapshot.revision+1};chamber.webContents.send('harmony:state',snapshot);};
   const replace=(name:string,handler:(...args:any[])=>any)=>{ipcMain.removeHandler('harmony:'+name);ipcMain.handle('harmony:'+name,handler);};
   replace('snapshot',()=>snapshot);replace('reasoning-connection',()=>({configured:true,model:'gpt-6-astra',verified:false}));
   replace('reasoning-review',(_event,text)=>publish({system:'ACTIVE',reasoning:{...snapshot.reasoning,state:'ESTIMATE_REVIEW',prompt:text,reviewId:'fixture-count'}}));
   replace('reasoning-approve',(_event,id)=>{if(id==='fixture-count'&&snapshot.reasoning.state==='ESTIMATE_REVIEW'){publish({system:'BUSY',reasoning:{...snapshot.reasoning,state:'ESTIMATING',reviewId:null}});return;}if(id!=='fixture')throw new Error('Denied');publish({system:'BUSY',reasoning:{...snapshot.reasoning,state:'STREAMING',reviewId:null,text:'Hello <script>inert</script>'}});});
   (globalThis as any).__finishEstimateFixture=()=>publish({system:'ACTIVE',reasoning:{...snapshot.reasoning,state:'REVIEW',reviewId:'fixture',estimate:{inputTokens:10,ceilingMicros:51325,estimateVersion:'fixture-prices'}}});
   (globalThis as any).__finishReasoningFixture=()=>publish({system:'PASSIVE',reasoning:{...snapshot.reasoning,state:'FINISHED',text:snapshot.reasoning.text+' — complete.',usage:{inputTokens:10,outputTokens:5}}});
  });
  await page.getByRole('button',{name:'System',exact:true}).click();await page.getByLabel('Your request to HARMONY').fill('Hello fixture');
  await page.getByRole('button',{name:'Review cloud request'}).click();await expect(page.getByRole('heading',{name:'Review before estimating'})).toBeVisible();
  await page.getByRole('button',{name:'Send for cost estimate'}).click();await expect(page.getByText('Getting the input count and cost estimate…',{exact:true})).toBeVisible();
  await expect(page.getByText('Getting a cloud cost estimate.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve and send to OpenAI'})).toHaveCount(0);
  await app.evaluate(()=>(globalThis as any).__finishEstimateFixture());
  await expect(page.getByRole('heading',{name:'Review before sending'})).toBeVisible();
  await expect(page.getByLabel('Estimated model cost')).toContainText('USD 0.051325');
  await page.getByRole('button',{name:'Approve and send to OpenAI'}).scrollIntoViewIfNeeded();await page.screenshot({path:'docs/reasoning-estimate-preview.png'});
  await page.getByRole('button',{name:'Approve and send to OpenAI'}).click();
  await expect(page.getByLabel('HARMONY response')).toHaveText('Hello <script>inert</script>');await expect(page.getByText('Receiving response…',{exact:true})).toBeVisible();
  await expect(page.locator('.presence')).toHaveAttribute('data-budget','processing');
  expect(await page.getByLabel('HARMONY response').locator('script').count()).toBe(0);
  await app.evaluate(()=>(globalThis as any).__finishReasoningFixture());
  await expect(page.getByText('Response complete',{exact:true})).toBeVisible();await expect(page.getByLabel('HARMONY response')).toHaveText('Hello <script>inert</script> — complete.');
  expect((await page.evaluate(()=>window.harmony!.snapshot())).identity).toBe('UNKNOWN');
 }finally{await app.close();}
});


test('Activity shows separate preparation durations using an offline timing fixture',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();
  await app.evaluate(async({BrowserWindow})=>{
   const chamber=BrowserWindow.getAllWindows()[0],snapshot=await chamber.webContents.executeJavaScript('window.harmony.snapshot()');
   chamber.webContents.send('harmony:state',{...snapshot,revision:snapshot.revision+1,speechOutput:{...snapshot.speechOutput,provider:'local',localEngine:'kokoro',state:'READY',preparation:[{stage:'model',elapsedMs:0},{stage:'acknowledgements',elapsedMs:20000},{stage:'warmup',elapsedMs:28000},{stage:'ready',elapsedMs:33000}]}});
  });
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await page.getByText('Developer latency profiler',{exact:true}).click();
  const timing=page.getByRole('region',{name:'Local voice preparation timing'});
  await expect(timing.getByText('20000 ms',{exact:true})).toBeVisible();
  await expect(timing.getByText('8000 ms',{exact:true})).toBeVisible();
  await expect(timing.getByText('5000 ms',{exact:true})).toBeVisible();
  await timing.scrollIntoViewIfNeeded();await page.screenshot({path:'docs/voice-preparation-timing-fixture.png'});
 }finally{await app.close();}
});


test('owner settings expose native setup only in the chamber without prompting during inspection',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Local owner verification'})).toBeVisible();
  expect(await page.evaluate(()=>window.harmony!.ownerStatus())).toEqual({configured:false,available:true,method:'windows-webauthn'});
  await expect(page.getByRole('button',{name:'Set up local owner'})).toBeEnabled();
  await page.getByRole('heading',{name:'Local owner verification'}).scrollIntoViewIfNeeded();await page.screenshot({path:'docs/owner-setup-preview.png'});
  const opened=app.waitForEvent('window');await page.getByRole('button',{name:'Float on desktop'}).click();const companion=await opened;
  expect(await companion.evaluate(()=>window.harmony!.ownerStatus().then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.ownerEnroll().then(()=>false,()=>true))).toBe(true);
  expect((await page.evaluate(()=>window.harmony!.ownerStatus())).configured).toBe(false);
 }finally{await app.close();}
});


test('allowance review shows exact amount, STOP revokes approval and companion cannot administer it',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await page.getByLabel('Allowance in USD',{exact:true}).fill('12.34');await page.getByRole('button',{name:'Review allowance',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review local allowance'})).toBeVisible();
  await expect(page.getByText(/Establish USD 12.340000/)).toBeVisible();
  const review=await page.evaluate(()=>window.harmony!.snapshot());expect(review.system).toBe('ACTIVE');expect(review.allowance?.balance).toBeNull();
  await page.getByRole('button',{name:'Verify owner and create allowance'}).scrollIntoViewIfNeeded();await page.screenshot({path:'docs/allowance-review-preview.png'});
  await page.getByRole('button',{name:'Stop all work',exact:true}).click();
  expect(await page.evaluate(id=>window.harmony!.allowanceApprove(id!).then(()=>false,()=>true),review.allowance!.reviewId)).toBe(true);
  await expect.poll(()=>page.evaluate(async()=>{const s=await window.harmony!.snapshot();return {system:s.system,stopping:s.stopping,failed:s.shutdownFailed};})).toEqual({system:'STOPPED',stopping:false,failed:false});await page.getByRole('button',{name:'Resume HARMONY',exact:true}).click();
  const opened=app.waitForEvent('window');await page.getByRole('button',{name:'Float on desktop'}).click();const companion=await opened;
  expect(await companion.evaluate(()=>window.harmony!.allowanceReview('1').then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.allowanceApprove('fake').then(()=>false,()=>true))).toBe(true);
  expect(await companion.evaluate(()=>window.harmony!.allowanceCancel().then(()=>false,()=>true))).toBe(true);
  expect((await page.evaluate(()=>window.harmony!.snapshot())).allowance?.balance).toBeNull();
 }finally{await app.close();}
});


test('allowance breakdown distinguishes held amounts from confirmed charges using an offline fixture',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await app.evaluate(async({BrowserWindow})=>{
   const chamber=BrowserWindow.getAllWindows()[0],s=await chamber.webContents.executeJavaScript('window.harmony.snapshot()');
   chamber.webContents.send('harmony:state',{...s,revision:s.revision+1,allowance:{...s.allowance,history:[{reference:'fixture-local-reference',model:'gpt-6-astra',state:'UNCERTAIN',ceilingMicros:200000,actualMicros:null}],balance:{limitMicros:1000000,committedMicros:300000,remainingMicros:700000,waitingMicros:50000,uncertainMicros:200000,settledMicros:50000,unresolvedCount:2}}});
  });
  const breakdown=page.getByLabel('Allowance breakdown');await breakdown.scrollIntoViewIfNeeded();
  await expect(breakdown).toContainText('Awaiting billing confirmation');await expect(breakdown).toContainText('USD 0.200000 · 2 requests');await expect(breakdown).toContainText('Confirmed charges');
  await expect(page.getByLabel('Local allowance balance')).toContainText('USD 0.700000 available');
  await page.screenshot({path:'docs/allowance-breakdown-fixture.png'});
  await page.getByText('Recent AI requests',{exact:true}).click();const history=page.getByRole('list',{name:'Allowance request history'});await history.scrollIntoViewIfNeeded();await expect(history).toContainText('fixture-local-reference');await expect(history).toContainText('Awaiting billing confirmation');await expect(history).toContainText('Estimated maximum: USD 0.200000');await page.screenshot({path:'docs/allowance-history-fixture.png'});
  expect((await page.evaluate(()=>window.harmony!.snapshot())).allowance?.balance).toBeNull();
 }finally{await app.close();}
});


test('explicit model selection reaches trusted review unchanged and invalid models are denied',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harmony:reasoning-connection');ipcMain.handle('harmony:reasoning-connection',()=>({configured:true,verified:false,model:'gpt-6-astra'}));});
  await page.getByRole('button',{name:'System',exact:true}).click();await expect(page.getByLabel('Reasoning model',{exact:true})).toHaveValue('gpt-6-astra');
  await page.getByLabel('Reasoning model',{exact:true}).selectOption('gpt-6-luna');await page.getByLabel('Your request to HARMONY').fill('Offline selection test');await page.getByRole('button',{name:'Review cloud request'}).click();
  await expect(page.getByText('Selected model: gpt-6-luna',{exact:true})).toBeVisible();expect((await page.evaluate(()=>window.harmony!.snapshot())).reasoning?.modelId).toBe('gpt-6-luna');
  await page.getByRole('button',{name:'Send for cost estimate'}).scrollIntoViewIfNeeded();await page.screenshot({path:'docs/model-selection-preview.png'});
  await page.getByRole('button',{name:'Cancel reasoning request'}).click();
  expect(await page.evaluate(()=>window.harmony!.reasoningReview('Hello','unknown' as any).then(()=>false,()=>true))).toBe(true);
  expect((await page.evaluate(()=>window.harmony!.snapshot())).system).toBe('PASSIVE');
 }finally{await app.close();}
});


test('automatic task-depth selection explains missing readiness without cloud disclosure',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.'),'--mute-audio'],env});
 try{
  const page=await app.firstWindow();await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harmony:reasoning-connection');ipcMain.handle('harmony:reasoning-connection',()=>({configured:true,verified:false,model:'gpt-6-astra'}));});
  await page.getByRole('button',{name:'System',exact:true}).click();await page.getByLabel('Reasoning model',{exact:true}).selectOption('auto:routine');
  await page.getByLabel('Your request to HARMONY').fill('Offline automatic selection check');await page.getByRole('button',{name:'Review cloud request'}).click();
  await expect(page.getByRole('alert')).toContainText('Automatic selection needs recent successful use');
  const snapshot=await page.evaluate(()=>window.harmony!.snapshot());expect(snapshot.system).toBe('PASSIVE');expect(snapshot.reasoning).toMatchObject({state:'ERROR',modelId:'gpt-6-luna',automatic:'routine',reviewId:null});
  await expect(page.getByRole('button',{name:'Send for cost estimate'})).toHaveCount(0);await page.getByRole('alert').scrollIntoViewIfNeeded();await page.screenshot({path:'docs/automatic-selection-preview.png'});
  await page.getByLabel('Reasoning model',{exact:true}).selectOption('gpt-6-luna');await page.getByRole('button',{name:'Review cloud request'}).click();
  await expect(page.getByText('Selected model: gpt-6-luna',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel reasoning request'}).click();
  expect(await page.evaluate(()=>window.harmony!.reasoningReview('Hello','auto:unknown' as any).then(()=>false,()=>true))).toBe(true);
 }finally{await app.close();}
});
