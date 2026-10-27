/** Checks screen awareness on this PC without controlling anything: starts the Windows helper, lists apps and windows,
 * and looks at the active window, this terminal (reading its text with Windows' OCR). Nothing is saved. Usage: npm run desktop:check
 */
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {PowerShellTransport} from '../core/desktop.ts';

if(process.platform!=='win32'){console.log('This check runs on Windows.');process.exit(1);}
const t=new PowerShellTransport(resolve(import.meta.dirname,'..'));
try{
 let start=performance.now();const apps=await t.request({type:'apps'},30000) as {apps:{name:string}[]};
 console.log(`Helper started and read ${apps.apps.length} Start menu apps in ${Math.round(performance.now()-start)} ms (text reading ${t.ocr?'available':'NOT available'}).`);
 console.log('  e.g.',apps.apps.slice(0,8).map(a=>a.name).join(', '));
 const w=await t.request({type:'windows',exclude_pid:process.pid},10000) as {windows:{app:string;title:string}[]};
 console.log(`\nOpen windows (${w.windows.length}):`);for(const x of w.windows.slice(0,10))console.log(`  ${x.app} — ${x.title.slice(0,80)}`);
 console.log('\nLooking at the active window (this terminal) and reading its text...');
 start=performance.now();const look=await t.request({type:'look',exclude_pid:0},30000) as {found:boolean;app:string;title:string;text:string;ms:number};
 if(!look.found)console.log('  No app window found.');
 else{console.log(`  ${look.app} — "${look.title.slice(0,100)}"\n  Read ${look.text.length} characters in ${look.ms} ms (total ${Math.round(performance.now()-start)} ms). First lines:`);
  for(const line of look.text.split('\n').slice(0,6))console.log('   |',line.slice(0,100));}
 console.log('\nThe screenshot was never saved. Nothing was opened or clicked.');
}catch(error){console.log('The helper did not work:',error instanceof Error?error.message:error);}
finally{await t.stop();}
