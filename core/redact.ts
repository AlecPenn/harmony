/** Masks secrets in text before it leaves this PC or is saved for later (October 27, after isair/jarvis's structural
 * redaction; our own code). Applied to: Spiral Time tickets for Claude, web search and news queries, research
 * objectives, and saved conversation history. It looks for the *shape* of a secret, not its meaning, so it can't
 * prove text is clean; it catches the common accidents (a card number read off the screen, a password said aloud, an
 * API key pasted into a note). Masked text keeps a short label, e.g. "[card number removed]", so the rest still
 * reads naturally. Pure and fast; no network, no model. */

/** Luhn check, so ordinary long numbers (order numbers, phone numbers) are left alone. */
export function luhn(digits:string):boolean{
 let sum=0,double=false;
 for(let i=digits.length-1;i>=0;i--){let d=digits.charCodeAt(i)-48;if(d<0||d>9)return false;if(double){d*=2;if(d>9)d-=9;}sum+=d;double=!double;}
 return digits.length>=13&&sum%10===0;
}

const RULES:[RegExp,string|((m:string,...g:string[])=>string)][]=[
 // Private keys and JWTs first (they contain things later rules would half-match).
 [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,'[private key removed]'],
 [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,'[token removed]'],
 // Credentials inside URLs: https://user:pass@host → https://host
 [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1'],
 // Provider-shaped keys.
 [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}\b/g,'[key removed]'],
 [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,'[key removed]'],
 [/\bAIza[0-9A-Za-z_-]{35}\b/g,'[key removed]'],
 [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,'[key removed]'],
 [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,'[key removed]'],
 [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,'Bearer [token removed]'],
 // "password: hunter2", "my password is hunter2", "pin 4821", "api key = ...".
 [/\b(pass(?:word|code|phrase)?|pwd|pin|api[ _-]?key|secret|token|access[ _-]?code)(\s*(?:is|was|:|=|equals)\s*)(["']?)([^\s"',;\[]{3,})\3/gi,(_m,k:string,sep:string)=>`${k}${sep}[removed]`],
 [/\b(pin|passcode)(\s+)(\d{4,8})\b/gi,(_m,k:string,sep:string)=>`${k}${sep}[removed]`],
 // One-time codes said or shown near the word "code".
 [/\b(code|verification|otp|2fa|one[- ]time)([^.\n]{0,20}?)\b(\d{6,8})\b/gi,(_m,a:string,b:string)=>`${a}${b}[code removed]`],
 // US Social Security numbers.
 [/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,'[SSN removed]'],
 // Card numbers: 13-19 digits, optionally grouped by spaces or dashes, that pass the Luhn check.
 [/\b(?:\d[ -]?){12,18}\d\b/g,m=>luhn(m.replace(/[ -]/g,''))?'[card number removed]':m],
 // Bank account / routing numbers when named as such.
 [/\b(account|acct|routing)(\s*(?:number|no\.?|#)?\s*(?:is|:)?\s*)(\d{6,17})\b/gi,(_m,a:string,b:string)=>`${a}${b}[number removed]`],
 // Long hex or base64-looking blobs (40+ chars with letters and digits mixed) are almost always keys or hashes.
 [/\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{40,}={0,2}/g,'[key removed]'],
];

/** The text with secrets masked. Never throws; anything it can't process is returned unchanged. */
export function redact(text:string):string{
 if(typeof text!=='string'||!text)return text;
 try{let out=text;for(const [re,to] of RULES)out=out.replace(re,to as never);return out;}catch{return text;}
}
/** True when redact() would change the text (for tests and for saying "I left out a password"). */
export const hasSecret=(text:string)=>redact(text)!==text;
/** For web addresses: only removes a user name and password written into the address (the rest must stay intact). */
export const redactUrl=(url:string)=>typeof url==='string'?url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/i,'$1'):url;
