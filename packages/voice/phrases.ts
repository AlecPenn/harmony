/** Bounded phrase framing for generated text. Does not authorize speech or tool execution. */
export class VoicePhrases {
 #pending='';#finished=false;#total=0;#emitted=false;
 /** earlyFirst: the first phrase may end at a clause break (comma, dash…) or about 90 characters, so speech starts sooner. */
 constructor(readonly maxPhrase=240,readonly maxTurn=16000,readonly earlyFirst=false){if(!Number.isSafeInteger(maxPhrase)||maxPhrase<32||maxPhrase>1000||!Number.isSafeInteger(maxTurn)||maxTurn<maxPhrase||maxTurn>100000)throw new Error('Invalid speech bounds');}
 push(fragment:string):string[]{
  if(this.#finished)throw new Error('Speech text stream closed');
  if(typeof fragment!=='string'||this.#total+fragment.length>this.maxTurn){this.cancel();throw new Error('Speech text limit exceeded');}
  this.#total+=fragment.length;this.#pending+=fragment;
  const out:string[]=[];
  while(this.#pending.length){
   // Require whitespace after punctuation so a decimal or split token is not emitted prematurely.
   const sentence=/[.!?]["’”']?\s|\n/.exec(this.#pending);
   let end=sentence?sentence.index+sentence[0].length:0;
   const cap=this.earlyFirst&&!this.#emitted?Math.min(90,this.maxPhrase):this.maxPhrase;
   if(this.earlyFirst&&!this.#emitted){
    // First clause of at least 40 characters, if it comes before the first full sentence (shorter fragments sound choppy).
    const clause=/[,;:]\s|\s[—–-]\s|—/g;let match:RegExpExecArray|null;
    while((match=clause.exec(this.#pending))){const at=match.index+match[0].length;if(at>=40){if(!end||at<end)end=at;break;}}
   }
   if(!end||end>cap){
    if(this.#pending.length<=cap)break;
    end=this.#pending.lastIndexOf(' ',cap);
    if(end<1)end=this.maxPhrase;
    // Never bisect a UTF-16 surrogate pair at the hard cap.
    const c=this.#pending.charCodeAt(end-1);if(c>=0xd800&&c<=0xdbff)end--;
   }
   const phrase=this.#pending.slice(0,end).trim();this.#pending=this.#pending.slice(end);
   if(phrase){out.push(phrase);this.#emitted=true;}
  }
  return out;
 }
 finish():string[]{if(this.#finished)throw new Error('Speech text stream closed');this.#finished=true;const tail=this.#pending.trim();this.#pending='';return tail?[tail]:[];}
 cancel(){this.#pending='';this.#finished=true;}
}
