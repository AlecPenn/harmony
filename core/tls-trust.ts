import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {X509Certificate} from 'node:crypto';
import tls from 'node:tls';

/** Distrusted certificate authorities (docs/DISTRUSTED-CAS.json). When a CA's key is reported stolen, certificates it
 * signs could impersonate any website (a fake Google, OpenAI, or the sites HARMONY downloads models from). HARMONY
 * refuses them in two places. In Node (her own lookups, feeds, sign-ins, downloads), the CA's roots are removed from
 * the trusted set. In Chromium (the God's Eye window and every other HARMONY window), every certificate in a chain is
 * checked and the connection is refused if any of them is from a distrusted CA, which also catches cross-signed
 * intermediates. Model and package downloads are also pinned by SHA-256 or lockfile hashes, so a forged site still
 * couldn't swap their contents. */
export function distrustPatterns(root:string):RegExp[]{
 try{
  const j=JSON.parse(readFileSync(join(root,'docs','DISTRUSTED-CAS.json'),'utf8')) as {entries?:{pattern?:unknown}[]};
  return (j.entries??[]).flatMap(e=>typeof e.pattern==='string'&&/^[A-Za-z0-9 .-]{3,60}$/.test(e.pattern)?[new RegExp(e.pattern.replace(/[.]/g,'\\.'),'i')]:[]);
 }catch{return [/eMudhra/i,/emSign/i];} // fail safe: keep the current incident's distrust even if the file is missing
}
const matches=(text:string,patterns:readonly RegExp[])=>patterns.some(p=>p.test(text));

/** Removes distrusted roots from Node's default trust store. Returns how many were removed (null if unsupported). */
export function distrustInNode(patterns:readonly RegExp[]):{removed:string[];kept:number}|null{
 const t=tls as typeof tls&{setDefaultCACertificates?:(certs:string[])=>void;getCACertificates?:(type?:string)=>string[]};
 if(typeof t.setDefaultCACertificates!=='function')return null;
 const current=typeof t.getCACertificates==='function'?t.getCACertificates('default'):[...tls.rootCertificates];
 const removed:string[]=[],kept:string[]=[];
 for(const pem of current){
  let subject='';try{const c=new X509Certificate(pem);subject=`${c.subject} ${c.issuer}`;}catch{kept.push(pem);continue;}
  if(matches(subject,patterns))removed.push(subject.split('\n').find(l=>l.startsWith('CN='))?.slice(3)??'unknown');else kept.push(pem);
 }
 if(removed.length)t.setDefaultCACertificates(kept);
 return {removed,kept:kept.length};
}
/** For Chromium's certificate verifier: true when any certificate in the chain is from a distrusted CA. */
export interface ChainCert {subjectName?:string;issuerName?:string;issuer?:{organizations?:string[];commonName?:string};subject?:{organizations?:string[];commonName?:string};issuerCert?:ChainCert|null;}
export function chainDistrusted(cert:ChainCert|null|undefined,patterns:readonly RegExp[]):boolean{
 for(let c=cert,i=0;c&&i<10;c=c.issuerCert,i++){
  const text=[c.subjectName,c.issuerName,...(c.subject?.organizations??[]),c.subject?.commonName,...(c.issuer?.organizations??[]),c.issuer?.commonName].filter(Boolean).join(' ');
  if(matches(text,patterns))return true;
 }
 return false;
}
