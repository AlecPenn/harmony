import {join} from 'node:path';
/** Test-only profile isolation; never accepts a caller-controlled filesystem path. */
export function desktopDataRoot(root:string,packaged:boolean,testProfile:string|undefined):string {
 if(testProfile===undefined)return join(root,'data');
 if(packaged||!/^test-[a-f0-9]{32}$/.test(testProfile))throw new Error('Invalid desktop test profile');
 return join(root,'data','test-profiles',testProfile);
}
