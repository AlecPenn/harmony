import {test,expect} from 'vitest';
import {join} from 'node:path';
import {desktopDataRoot} from '../core/desktop-data.ts';
test('normal profiles stay unchanged and test profiles use a fixed isolated child',()=>{
 expect(desktopDataRoot('fixture',false,undefined)).toBe(join('fixture','data'));
 expect(desktopDataRoot('fixture',true,undefined)).toBe(join('fixture','data'));
 const id='test-'+'a'.repeat(32);
 expect(desktopDataRoot('fixture',false,id)).toBe(join('fixture','data','test-profiles',id));
 expect(()=>desktopDataRoot('fixture',true,id)).toThrow();
});
test('test profile cannot supply paths, aliases or malformed identifiers',()=>{
 for(const value of ['', '..','../data','C:\\other','test-CON','test-'+'a'.repeat(31),'test-'+'a'.repeat(32)+'/..'])
  expect(()=>desktopDataRoot('fixture',false,value)).toThrow();
});
