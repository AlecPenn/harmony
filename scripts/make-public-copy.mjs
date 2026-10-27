// Makes the public copy of HARMONY for GitHub: the committed files minus private notes, into a new folder with a
// fresh git history (one commit), after checking that nothing personal or secret is in it.
//
//   node scripts/make-public-copy.mjs --report              list what would be published and any problems
//   node scripts/make-public-copy.mjs <folder> [--email x]  write the copy and make its first commit (not pushed)
//
// Personal words to look for are read from data/release-blocklist.txt (one regular expression per line). That file
// is in the ignored data folder on purpose: a list of your private words must not be published either.
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),report=args.includes('--report');
const email=args.includes('--email')?args[args.indexOf('--email')+1]:'harmony@users.noreply.github.com';
const target=args.find((a,i)=>!a.startsWith('--')&&args[i-1]!=='--email');

/** Private notes, early plans and leftovers that stay on the PC. */
const EXCLUDE=[
 /^docs\/(MASTER-CODEX|MASTER-ROADMAP-UPDATE|HARMONY-REFERENCE|CLAUDE-HANDOFF|JARVIS-REFERENCE-AUDIT|JARVIS-SOURCE-MANIFEST|ALIGNMENT|VALIDATION|ROADMAP|CHANGELOG|REQUIREMENT-UPDATES|MANUAL-ACCEPTANCE|BILLING-RECONCILIATION|MODEL-ROUTING|ORCHESTRATION|VOICE-ROUTING|LATENCY|HOUSEHOLD-IDENTITY|FILES|STATE|EVENTS|ACTION-JOURNAL|AGENTS-AND-MISSIONS|REASONING|SELF-IMPROVE|UI|DESKTOP-COMPANION|SPEED|ARCHITECTURE)\.(md|json)$/,
 /^docs\/[^/]+\.png$/,/^docs\/licenses\/Dix01-JARVIS-MIT\.txt$/,/^previews\//,/^memory\//,/^tools\/[^/]+\/\.gitkeep$/,
 /^Make Australian Voice\.cmd$/,/^build-verification/,/^onnx-(install|resolution)/,/^test-results\//,
];
/** Shapes of real secrets (fake test values are short or clearly fake). */
const SECRETS=[/sk-(?:proj|ant|live)?-?[A-Za-z0-9_-]{32,}/,/AIza[0-9A-Za-z_-]{35}/,/gh[pousr]_[A-Za-z0-9]{36,}/,/AKIA[A-Z0-9]{16}/,/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/GOCSPX-[A-Za-z0-9_-]{24,}/,/xox[abp]-\d{6,}-/];
const TEXT=/\.(ts|tsx|mjs|cjs|js|json|md|txt|py|ps1|cmd|css|html|yml|yaml|toml|cfg|ini|gitignore|gitattributes|example)$|^[^.]+$/i;

const files=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).split('\n').filter(Boolean)
 .filter(f=>!EXCLUDE.some(re=>re.test(f))&&existsSync(join(root,f)));
const blockFile=join(root,'data','release-blocklist.txt');
const block=existsSync(blockFile)?readFileSync(blockFile,'utf8').split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')).map(l=>new RegExp(l,'i')):[];
if(!block.length)console.warn('Warning: no data/release-blocklist.txt, so personal words are not being checked.');

const problems=[];
for(const f of files){
 for(const re of block)if(re.test(f))problems.push(`${f}: file name matches ${re}`);
 if(!TEXT.test(f.split('/').pop()))continue;
 const lines=readFileSync(join(root,f),'utf8').split('\n');
 lines.forEach((line,i)=>{
  for(const re of block)if(re.test(line))problems.push(`${f}:${i+1}: personal (${re.source})`);
  for(const re of SECRETS)if(re.test(line))problems.push(`${f}:${i+1}: looks like a secret (${re.source.slice(0,24)})`);
 });
}
console.log(`${files.length} files to publish, ${problems.length} problem${problems.length===1?'':'s'}.`);
for(const p of problems.slice(0,200))console.log('  '+p);
if(report)process.exit(problems.length?1:0);
if(problems.length){console.error('Not written: fix the problems above first.');process.exit(1);}
if(!target){console.error('Say where to write the copy, e.g. node scripts/make-public-copy.mjs ..\\HARMONY-public');process.exit(1);}
const out=resolve(target);
if(existsSync(out)&&readdirSync(out).length){console.error(`${out} isn't empty; choose a new folder.`);process.exit(1);}
for(const f of files){const to=join(out,f);mkdirSync(dirname(to),{recursive:true});copyFileSync(join(root,f),to);}
const git=(...a)=>execFileSync('git',a,{cwd:out,stdio:'inherit'});
git('init','-q','-b','main');git('add','-A','-f','.'); // -f: every copied file was chosen above, whatever .gitignore says
git('-c',`user.name=Alec Penn`,'-c',`user.email=${email}`,'commit','-q','-m','HARMONY: first public release');
console.log(`Written to ${out} with one commit on "main". Nothing was pushed.`);
