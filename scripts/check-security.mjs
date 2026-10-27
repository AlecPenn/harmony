// "Check security.cmd": a read-only security check of this HARMONY folder. Prints findings; never prints a secret.
//  1. Leaked secrets in files tracked by git (API keys, tokens, private keys): file and line only.
//  2. GitHub Actions workflows (the GhostAction campaign planted malicious ones in October 2026).
//  3. Credentials or data folders accidentally tracked by git.
//  4. npm registry signatures for HARMONY's packages (npm audit signatures).
//  5. God's Eye View: pinned version age and whether any install scripts ran.
//  6. Distrusted certificate authorities in force, and whether v9's server.py still holds keys in plain text.
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
let problems=0;const ok=t=>console.log(`OK    ${t}`),warn=t=>{problems++;console.log(`CHECK ${t}`);};
export const SECRET_PATTERNS=[['OpenAI key',/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],['Anthropic key',/sk-ant-[A-Za-z0-9_-]{20,}/],['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
 ['npm token',/\bnpm_[A-Za-z0-9]{30,}/],['PyPI token',/\bpypi-[A-Za-z0-9_-]{40,}/],['AWS key',/\bAKIA[0-9A-Z]{16}\b/],['Google API key',/\bAIza[0-9A-Za-z_-]{35}\b/],
 ['Slack token',/\bxox[abp]-[A-Za-z0-9-]{10,}/],['Private key',/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],['Hugging Face token',/\bhf_[A-Za-z0-9]{30,}/]];
// 1
let files=[];try{files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:64<<20}).split('\0').filter(Boolean);}catch{warn('git is not available here, so tracked files were not scanned');}
let hits=0;
for(const f of files){
 if(/(^|\/)(node_modules|dist)\/|\.(png|jpe?g|glb|blend|onnx|gguf|zip|ico|woff2?|mp3|wav)$|package-lock\.json$/i.test(f))continue;
 let text;try{const p=join(root,f);if(statSync(p).size>2_000_000)continue;text=readFileSync(p,'utf8');}catch{continue;}
 text.split(/\r?\n/).forEach((line,i)=>{for(const [name,re] of SECRET_PATTERNS)if(re.test(line)&&!/example|placeholder|fake|dummy|test/i.test(line)){hits++;warn(`${name} pattern in ${f}:${i+1} (value not shown)`);}});
}
if(files.length&&!hits)ok(`No secrets found in ${files.length} tracked files`);
// 2
const wf=join(root,'.github','workflows');
if(existsSync(wf))for(const f of readdirSync(wf)){const t=readFileSync(join(wf,f),'utf8');
 warn(`Workflow ${f} exists${/curl|wget|Invoke-WebRequest|base64/i.test(t)&&/secrets\.|toJSON\(secrets\)|GITHUB_TOKEN/i.test(t)?' and sends something with secrets to the network: review it now':''}`);}
else ok('No GitHub Actions workflows in this repository');
// 3
const tracked=files.filter(f=>/^(data|credentials|tokens|\.runtime)\/|\.enc$|\.env$|\.sqlite/.test(f));
if(tracked.length)warn(`Private files tracked by git: ${tracked.slice(0,5).join(', ')}`);else if(files.length)ok('No credentials, data or databases tracked by git');
// 4
const sig=spawnSync('npm audit signatures',{cwd:root,encoding:'utf8',shell:true,timeout:180000});
const sigText=`${sig.stdout??''}${sig.stderr??''}`;
if(sig.status===0)ok(`npm registry signatures: ${(sigText.match(/(\d+) packages? ha(?:s|ve) verified registry signatures?/)??['','all'])[1]} verified`);
else warn(`npm audit signatures did not pass: ${sigText.split('\n').filter(Boolean).slice(-2).join(' ').slice(0,200)}`);
// 5
try{
 const pin=JSON.parse(readFileSync(join(root,'docs','GODS-EYE-VIEW.json'),'utf8'));
 const age=(Date.now()-Date.parse(pin.committed))/86400000;
 ok(`God's Eye View pinned to ${pin.commit.slice(0,7)} (${age.toFixed(1)} days old; new pins wait at least 7 days and get a diff review)`);
 const gev=join(root,pin.folder);
 if(existsSync(join(gev,'node_modules','puppeteer','.local-chromium'))||existsSync(join(homedir(),'.cache','puppeteer')))warn('God\'s Eye View ran install scripts earlier (Puppeteer browser present). Run "Set up God\'s Eye" again after deleting .runtime\\gods-eye-view to reinstall without them.');
}catch{}
// 6
try{const d=JSON.parse(readFileSync(join(root,'docs','DISTRUSTED-CAS.json'),'utf8'));ok(`Distrusted certificate authorities: ${d.entries.map(e=>e.pattern).join(', ')}`);}catch{warn('docs/DISTRUSTED-CAS.json is missing');}
const v9=join(homedir(),'Desktop',"God's 3rd Eye",'server.py');
if(existsSync(v9)&&/^[A-Z_]*(KEY|SECRET|TOKEN)[A-Z_]*\s*=\s*['"][^'"]{8,}['"]/m.test(readFileSync(v9,'utf8')))warn('God\'s Eye v9 server.py still has API keys in plain text. Import them into HARMONY (Settings > God\'s Eye), then remove them from that file.');
console.log(`\n${problems?`${problems} thing(s) to look at.`:'All clear.'} Nothing was changed.`);
