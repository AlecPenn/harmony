import {copyFileSync,existsSync,mkdirSync,readdirSync,renameSync,statSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';

/** Backups (Part LXVIII): the database (memory, projects, reminders, ideas, research, settings) and the settings file, as a
 * consistent snapshot on this PC. Secrets are never included: the encrypted credential files stay where they are (they
 * only work under this Windows account anyway). One automatic backup a day, the newest 7 kept; restore takes effect on the
 * next start, and the database it replaces is kept beside it. */
export interface BackupInfo {name:string;at:string;bytes:number;}
export const KEEP_BACKUPS=7;
const NAME=/^harmony-(\d{8}-\d{6})\.sqlite$/;
const stamp=(d:Date)=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
const parse=(s:string)=>new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(9,11),+s.slice(11,13),+s.slice(13,15));

export class Backups {
 private dir:string;private dbPath:string;private configPath:string|null;private now:()=>Date;
 constructor(dir:string,dbPath:string,configPath:string|null,now:()=>Date=()=>new Date()){this.dir=dir;this.dbPath=dbPath;this.configPath=configPath;this.now=now;}
 list():BackupInfo[]{
  if(!existsSync(this.dir))return [];
  return readdirSync(this.dir).map(n=>n.match(NAME)).filter((m):m is RegExpMatchArray=>!!m).map(m=>({name:m[0],at:parse(m[1]).toISOString(),bytes:statSync(join(this.dir,m[0])).size}))
   .sort((a,b)=>b.at.localeCompare(a.at));
 }
 /** A consistent copy made by SQLite itself (VACUUM INTO), safe while HARMONY is running. */
 create(db:DatabaseSync):BackupInfo{
  mkdirSync(this.dir,{recursive:true});
  const name=`harmony-${stamp(this.now())}.sqlite`,path=join(this.dir,name);
  if(existsSync(path))unlinkSync(path);
  db.exec(`VACUUM INTO '${path.replace(/'/g,"''")}'`);
  if(this.configPath&&existsSync(this.configPath))copyFileSync(this.configPath,join(this.dir,name.replace(/\.sqlite$/,'.settings.json')));
  for(const old of this.list().slice(KEEP_BACKUPS)){try{unlinkSync(join(this.dir,old.name));}catch{}try{unlinkSync(join(this.dir,old.name.replace(/\.sqlite$/,'.settings.json')));}catch{}}
  return this.list().find(b=>b.name===name)!;
 }
 /** Daily: only when the newest backup is older than a day. */
 daily(db:DatabaseSync):BackupInfo|null{const last=this.list()[0];if(last&&this.now().getTime()-Date.parse(last.at)<24*3600000)return null;return this.create(db);}
 /** Marks a backup to be restored on the next start (two clicks in Settings). */
 requestRestore(name:string):boolean{
  if(!NAME.test(name)||!existsSync(join(this.dir,name)))return false;
  copyFileSync(join(this.dir,name),join(this.dir,'restore-pending.sqlite'));return true;
 }
 get restorePending(){return existsSync(join(this.dir,'restore-pending.sqlite'));}
 cancelRestore(){try{unlinkSync(join(this.dir,'restore-pending.sqlite'));}catch{}}
 /** Called before the database is opened. The current database is kept as harmony-before-restore.sqlite. */
 applyPendingRestore():boolean{
  const pending=join(this.dir,'restore-pending.sqlite');if(!existsSync(pending))return false;
  if(existsSync(this.dbPath))copyFileSync(this.dbPath,join(this.dir,'harmony-before-restore.sqlite'));
  for(const suffix of ['-wal','-shm'])try{unlinkSync(this.dbPath+suffix);}catch{}
  renameSync(pending,this.dbPath);return true;
 }
}
