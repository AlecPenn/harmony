import {expect,it} from 'vitest';
import {join} from 'node:path';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {distrustPatterns,distrustInNode,chainDistrusted} from '../core/tls-trust.ts';
const root=join(import.meta.dirname,'..');
it('reads the distrust list (and fails safe)',()=>{
 expect(distrustPatterns(root).map(r=>r.source)).toEqual(['eMudhra','emSign']);
 expect(distrustPatterns('/nonexistent').length).toBe(2);
});
it('removes eMudhra/emSign roots from Node\'s trust store and keeps the rest',()=>{
 const t=tls as typeof tls&{getCACertificates?:(k?:string)=>string[];setDefaultCACertificates?:(c:string[])=>void};
 if(!t.setDefaultCACertificates||!t.getCACertificates)return;
 const before=t.getCACertificates('default');
 try{
  t.setDefaultCACertificates(t.getCACertificates('bundled')); // as on Alec's PC (this container uses an OpenSSL store)
  const start=t.getCACertificates('default').length;
  const r=distrustInNode(distrustPatterns(root))!;
  expect(r.removed.length).toBeGreaterThanOrEqual(1);expect(r.removed.join()).toMatch(/emSign/);
  const after=t.getCACertificates('default');
  expect(after.some(p=>/eMudhra/i.test(new X509Certificate(p).subject))).toBe(false);
  expect(after.length).toBe(start-r.removed.length);
 }finally{t.setDefaultCACertificates(before);}
});
it('rejects a Chromium chain if any link is a distrusted CA, including cross-signed intermediates',()=>{
 const p=distrustPatterns(root);
 const leaf=(issuer:object|null)=>({subjectName:'example.com',issuerName:'Some Intermediate',issuerCert:issuer});
 expect(chainDistrusted(leaf({subjectName:'Some Intermediate',issuerName:'emSign Root CA - G1',issuerCert:null}),p)).toBe(true);
 expect(chainDistrusted(leaf({subjectName:'Some Intermediate',issuerName:'Good Root',issuer:{organizations:['eMudhra Technologies Limited']},issuerCert:null}),p)).toBe(true);
 expect(chainDistrusted(leaf({subjectName:'R11',issuerName:'ISRG Root X1',issuerCert:{subjectName:'ISRG Root X1',issuerName:'ISRG Root X1',issuerCert:null}}),p)).toBe(false);
});
