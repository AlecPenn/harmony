import {test,expect} from 'vitest';
import {mkdtempSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../core/storage.ts';
import {MemoryStore} from '../core/memory.ts';
import {Backups,KEEP_BACKUPS} from '../core/backup.ts';
import {diagnose} from '../core/diagnostics.ts';

test('backups: consistent copies, daily only, newest 7 kept, settings alongside, never credentials; restore on next start',()=>{
 const root=mkdtempSync(join(tmpdir(),'harmony-backup-')),dbPath=join(root,'database','harmony.sqlite'),cfg=join(root,'settings.json');
 writeFileSync(cfg,'{"theme":"dark"}');writeFileSync(join(root,'google.enc'),'secret');
 let now=new Date(2026,9,21,12,0,0);const b=new Backups(join(root,'backups'),dbPath,cfg,()=>new Date(now));
 let db=openDatabase(dbPath);new MemoryStore(db).add('Dave is my plumber','typed');
 const first=b.daily(db)!;expect(first.name).toBe('harmony-20261021-120000.sqlite');expect(b.daily(db)).toBeNull();
 expect(existsSync(join(root,'backups','harmony-20261021-120000.settings.json'))).toBe(true);
 expect(readFileSync(join(root,'backups',first.name)).includes(Buffer.from('secret'))).toBe(false);
 for(let i=1;i<=9;i++){now=new Date(now.getTime()+86400000);b.daily(db);}
 expect(b.list()).toHaveLength(KEEP_BACKUPS);expect(b.list()[0].at>b.list()[6].at).toBe(true);
 new MemoryStore(db).add('Something added after the backup','typed');
 expect(b.requestRestore('../evil.sqlite')).toBe(false);expect(b.requestRestore(b.list()[0].name)).toBe(true);expect(b.restorePending).toBe(true);
 db.close();expect(b.applyPendingRestore()).toBe(true);expect(b.restorePending).toBe(false);
 expect(existsSync(join(root,'backups','harmony-before-restore.sqlite'))).toBe(true);
 db=openDatabase(dbPath);expect(new MemoryStore(db).active().map(m=>m.text)).toEqual(['Dave is my plumber']);db.close();
});

test('"why are you slow?" reports measured parts and names the slowest',()=>{
 const r=diagnose({sttMs:300,firstWordsMs:3600,firstAudioMs:3900,playbackStartMs:4000,toolMs:1200,at:new Date(2026,9,21,12,0).toISOString()},{speechMs:900,brainMs:5000,voiceMs:1200,totalMs:5100},4200);
 expect(r).toContain('Understanding your words (speech to text): 300 ms');expect(r).toContain('Lookup or action: 1200 ms');
 expect(r).toContain('Brain, until the first words: 2100 ms');expect(r).toContain('Voice, from first words to first sound: 300 ms');
 expect(r).toContain('Slowest part: the brain (2100 ms)');expect(r).toContain('Conversation start: 5100 ms');
 expect(diagnose(null,null,null)).toBe('No spoken reply has been measured yet in this session.');
});
