import {expect,it} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {keysFromV9,gevEnv,WorldKeyStore,validateKeys} from '../core/world-keys.ts';

const SAMPLE=`import os
OPENSKY_CLIENT_ID     = "example-client-id"
OPENSKY_CLIENT_SECRET = 'example-secret-1234'
MY_EMAIL              = "someone@example.com"
NASA_FIRMS_MAP_KEY    = "abcd1234abcd1234"   # map key
AIS_API_KEY           = "ais-example-key"
NASA_API_KEY          = "your_key_here"
UNKNOWN_THING         = "not imported"
def f():
    OTX_API_KEY = "indented is not a constant"
`;
it('reads only known key constants from v9 (never the email, placeholders or indented code)',()=>{
 const k=keysFromV9(SAMPLE);
 expect(Object.keys(k).sort()).toEqual(['AIS_API_KEY','NASA_FIRMS_MAP_KEY','OPENSKY_CLIENT_ID','OPENSKY_CLIENT_SECRET']);
 expect(validateKeys({...k,EVIL:'x'.repeat(10)})).toEqual(k);
});
it('maps to God\'s Eye View\'s own variable names',()=>{
 expect(gevEnv(keysFromV9(SAMPLE))).toEqual({FIRMS_MAP_KEY:'abcd1234abcd1234',OPENSKY_AUTH_MODE:'oauth',OPENSKY_CLIENT_ID:'example-client-id',OPENSKY_CLIENT_SECRET:'example-secret-1234',AISSTREAM_API_KEY:'ais-example-key'});
 expect(gevEnv({})).toEqual({});
});
it('stores keys encrypted; status shows names only',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'wk-')),'world-keys.enc');
 const cipher={available:async()=>true,encrypt:async(t:string)=>Buffer.from(t.split('').reverse().join('')),decrypt:async(b:Buffer)=>b.toString().split('').reverse().join('')};
 const store=new WorldKeyStore(path,cipher);
 expect(await store.importV9(SAMPLE)).toHaveLength(4);
 expect(readFileSync(path,'utf8')).not.toContain('abcd1234abcd1234');
 const st=await store.status();expect(st.names).toContain('NASA_FIRMS_MAP_KEY');expect(JSON.stringify(st)).not.toContain('abcd1234');
 expect((await store.keys()).AIS_API_KEY).toBe('ais-example-key');
 expect(await store.importV9('nothing here')).toEqual([]);
});
