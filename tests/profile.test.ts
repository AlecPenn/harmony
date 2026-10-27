import {expect,test} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readProfile,writeHome} from '../core/profile.ts';

test('the private profile is read from data/profile.json, cleaned, and optional',()=>{
 const root=mkdtempSync(join(tmpdir(),'profile-'));
 expect(readProfile(root)).toEqual({});
 mkdirSync(join(root,'data'));writeFileSync(join(root,'data','profile.json'),JSON.stringify({job:{name:'Alex\u0007 Example',minPay:'$70k',enabled:true,other:'ignored',skills:42}}));
 expect(readProfile(root)).toEqual({job:{name:'Alex  Example',minPay:'$70k',enabled:true}});
 writeFileSync(join(root,'data','profile.json'),'{not json');expect(readProfile(root)).toEqual({});
});

test('saving home preserves other profile fields and refuses damaged or invalid input',()=>{
 const root=mkdtempSync(join(tmpdir(),'profile-home-')),dir=join(root,'data'),path=join(dir,'profile.json');
 mkdirSync(dir);writeFileSync(path,JSON.stringify({job:{name:'Example',other:'keep'},extra:{keep:true}}));
 expect(writeHome(root,{place:'  Portland, Oregon  ',lat:45.5,lon:-122.6})).toEqual({place:'Portland, Oregon',lat:45.5,lon:-122.6});
 expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({job:{name:'Example',other:'keep'},extra:{keep:true},home:{place:'Portland, Oregon',lat:45.5,lon:-122.6}});
 expect(()=>writeHome(root,{place:'X',lat:91,lon:0})).toThrow();
 expect(()=>writeHome(root,{place:'Valid',lat:10})).toThrow();
 writeFileSync(path,'{broken');expect(()=>writeHome(root,{place:'Valid'})).toThrow();expect(readFileSync(path,'utf8')).toBe('{broken');
});

test('desktop test profile stores home separately from the normal profile',()=>{
 const root=mkdtempSync(join(tmpdir(),'profile-isolation-')),testDir=join(root,'data','test-profiles','test-fixture');
 writeHome(root,{place:'Normal town'});writeHome(root,{place:'Test town'},testDir);
 expect(readProfile(root).home?.place).toBe('Normal town');expect(readProfile(root,testDir).home?.place).toBe('Test town');
});
