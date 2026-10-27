// Installs God's Eye View for HARMONY, pinned to one exact commit (docs/GODS-EYE-VIEW.json). Explicit, one time.
// Download → size and SHA-256 check → unpack into .runtime/gods-eye-view → npm ci (lockfile integrity) → done.
import {createHash} from 'node:crypto';
import {createWriteStream,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {applyOverlay} from '../core/gods-eye-overlay.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(readFileSync(join(root,'docs','GODS-EYE-VIEW.json'),'utf8'));
const target=resolve(root,pin.folder),runtime=resolve(root,'.runtime');
if(!target.startsWith(runtime))throw new Error('Unsafe install folder');
const say=t=>console.log(t);
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<24||(major===24&&minor<14)){say(`God's Eye View needs Node 24.14 or newer; this PC has ${process.versions.node}. Install the current Node 24 LTS from nodejs.org, then run this again.`);process.exit(1);}
const marker=join(target,'.harmony-installed.json');
// HARMONY's additions (overlays/gods-eye), laid on top and checked file by file; HARMONY also does this each time it starts God's Eye.
const overlay=()=>{try{const r=applyOverlay(target,join(root,'overlays','gods-eye'),pin.commit);say(r.skipped?`HARMONY's additions were not applied: ${r.skipped}`:`HARMONY's additions are on (${r.applied?`${r.applied} files`:'already'}).`);}catch(e){say(`HARMONY's additions were not applied: ${e.message}`);}};
try{const m=JSON.parse(readFileSync(marker,'utf8'));if(m.commit===pin.commit&&existsSync(join(target,'node_modules','vite'))){say(`God's Eye View ${pin.commit.slice(0,7)} is already installed.`);overlay();process.exit(0);}}catch{}
mkdirSync(runtime,{recursive:true});
const zip=join(runtime,'gods-eye-view.zip.download');
say(`Downloading God's Eye View ${pin.commit.slice(0,7)} (about ${Math.round(pin.archiveBytes/1e6)} MB)...`);
const res=await fetch(pin.archive);if(!res.ok||!res.body)throw new Error(`Download failed (${res.status})`);
const hash=createHash('sha256');let size=0;const out=createWriteStream(zip);
for await(const chunk of res.body){size+=chunk.length;if(size>pin.archiveBytes)throw new Error('Download is larger than expected');hash.update(chunk);if(!out.write(chunk))await new Promise(r=>out.once('drain',r));}
await new Promise((r,j)=>out.end(e=>e?j(e):r()));
if(size!==pin.archiveBytes||hash.digest('hex')!==pin.archiveSha256){rmSync(zip,{force:true});throw new Error('The download did not match its pinned fingerprint, so nothing was installed.');}
say('Fingerprint matches. Unpacking...');
const staging=join(runtime,'gods-eye-view.staging');rmSync(staging,{recursive:true,force:true});mkdirSync(staging);
// Windows 10+ includes tar (bsdtar), which unpacks zip files; PowerShell's Expand-Archive and unzip are fallbacks.
const tries=[['tar',['-xf',zip,'-C',staging]],...(process.platform==='win32'?[['powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${zip.replace(/'/g,"''")}' -DestinationPath '${staging.replace(/'/g,"''")}' -Force`]]]:[['unzip',['-q',zip,'-d',staging]]])];
let unpacked=false;
for(const [cmd,args] of tries){rmSync(staging,{recursive:true,force:true});mkdirSync(staging);if(spawnSync(cmd,args,{stdio:'ignore'}).status===0&&readdirSync(staging).length){unpacked=true;break;}}
if(!unpacked){rmSync(staging,{recursive:true,force:true});rmSync(zip,{force:true});throw new Error('Could not unpack the archive.');}
const inner=readdirSync(staging);if(inner.length!==1)throw new Error('Unexpected archive layout');
rmSync(target,{recursive:true,force:true});renameSync(join(staging,inner[0]),target);rmSync(staging,{recursive:true,force:true});rmSync(zip,{force:true});
say('Installing its parts (npm ci, checked against its lockfile)... this takes a few minutes the first time.');
// No install scripts run (--ignore-scripts): a hijacked package can't execute code at install time (the GhostAction
// lesson, October 2026). God's Eye View runs fine without them; its test browser (Puppeteer, ~300 MB) isn't downloaded.
const npm=spawnSync('npm ci --ignore-scripts --no-audit --no-fund',{cwd:target,stdio:'inherit',shell:true,env:{...process.env,PUPPETEER_SKIP_DOWNLOAD:'1',PUPPETEER_SKIP_CHROME_DOWNLOAD:'1'}});
if(npm.status!==0)throw new Error('npm ci failed. Check your internet connection and run this again.');
writeFileSync(marker,JSON.stringify({commit:pin.commit,installedAt:new Date().toISOString()},null,1));
overlay();
say(`God's Eye View is ready. In HARMONY: say "Harmony, open God's Eye", or use the God's Eye button.`);
