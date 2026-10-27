import {expect,test} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readProfile} from '../core/profile.ts';

test('the private profile is read from data/profile.json, cleaned, and optional',()=>{
 const root=mkdtempSync(join(tmpdir(),'profile-'));
 expect(readProfile(root)).toEqual({});
 mkdirSync(join(root,'data'));writeFileSync(join(root,'data','profile.json'),JSON.stringify({job:{name:'Alex\u0007 Example',minPay:'$70k',enabled:true,other:'ignored',skills:42}}));
 expect(readProfile(root)).toEqual({job:{name:'Alex  Example',minPay:'$70k',enabled:true}});
 writeFileSync(join(root,'data','profile.json'),'{not json');expect(readProfile(root)).toEqual({});
});
