// Development tool: rebuilds overlays/gods-eye/manifest.json from the files under overlays/gods-eye/files, hashing
// each against a checkout of the pinned God's Eye View. Usage: node scripts/make-gods-eye-overlay.ts <upstream checkout>
import {readdirSync,statSync,writeFileSync,readFileSync} from 'node:fs';
import {join,relative,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {manifestEntry} from '../core/gods-eye-overlay.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=join(root,'overlays','gods-eye'),files=join(dir,'files');
const upstream=resolve(process.argv[2]??'');
const pin=JSON.parse(readFileSync(join(root,'docs','GODS-EYE-VIEW.json'),'utf8'));
const walk=(d:string):string[]=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?walk(p):[p];});
const list=walk(files).map(p=>relative(files,p).split('\\').join('/')).sort();
writeFileSync(join(dir,'manifest.json'),JSON.stringify({version:1,commit:pin.commit,files:list.map(p=>manifestEntry(upstream,dir,p))},null,1)+'\n');
console.log(`${list.length} overlay files for ${pin.commit.slice(0,7)}`);
