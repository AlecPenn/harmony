import {test,expect} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {mediaItems} from '../core/media.ts';
import {MissionStore} from '../core/missions.ts';
import {WorkspaceStore} from '../core/workspace.ts';

test('the media chamber shows research, lookups and saved places as cards, newest first, with only web addresses as sources',()=>{
 const db=openDatabase(':memory:');let t=new Date(2026,9,21,9,0);const clock=()=>new Date(t);
 db.prepare("INSERT INTO web_lookups (id,at,kind,query,sources) VALUES ('a',?, 'search','silent disco cost',?)").run(t.toISOString(),JSON.stringify([{title:'Guide',url:'https://partyplanner.com/x',site:'partyplanner.com'},{title:'Bad',url:'javascript:alert(1)',site:'x'}]));
 db.prepare("INSERT INTO web_lookups (id,at,kind,query,sources) VALUES ('b',?, 'weather','Madison','[]')").run(t.toISOString());
 t=new Date(2026,9,21,10,0);
 const m=new MissionStore(db,clock).create('Plan a sunset listening party',null);const store=new MissionStore(db,clock),mm=store.get(m.id)!;
 mm.status='DONE';mm.report='Rent 20 headsets [1].\n\nSources:\n[1] Guide — https://partyplanner.com/x';mm.state.evidence=[{n:1,title:'Guide',url:'https://partyplanner.com/x',site:'partyplanner.com',excerpt:'',query:''}];store.save(mm);
 t=new Date(2026,9,21,11,0);new WorkspaceStore(db,null,clock).save([{hwnd:1,app:'Spotify',title:'Spotify Premium'}],[]);
 const items=mediaItems(db);
 expect(items.map(i=>i.kind)).toEqual(['snapshot','document','webpages']);
 expect(items[1]).toMatchObject({title:'Plan a sunset listening party',subtitle:'Research report',body:'Rent 20 headsets [1].'});
 expect(items[2].sources).toEqual([{title:'Guide',url:'https://partyplanner.com/x',site:'partyplanner.com'}]);
 expect(items[0]).toMatchObject({subtitle:'1 window',body:'Spotify — Spotify Premium'});
 db.close();
});
