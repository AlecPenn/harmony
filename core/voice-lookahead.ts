import type {VoiceChunk} from '../packages/contracts/voice-output.ts';
/** Private fixed-script lookahead: at most 60 validated 100 ms frames (288 KB PCM).
 * The owner must also stop its worker on abort; an iterator cannot interrupt native inference.
 */
export async function* voiceLookahead(source:AsyncIterable<VoiceChunk>,signal:AbortSignal):AsyncGenerator<VoiceChunk>{
 const queue:VoiceChunk[]=[],waiters=new Set<()=>void>();let closed=false,finished=false,failure:unknown=null;
 const wake=()=>{for(const resolve of waiters)resolve();waiters.clear();};
 const wait=()=>new Promise<void>(resolve=>waiters.add(resolve));
 const iterator=source[Symbol.asyncIterator]();signal.addEventListener('abort',wake,{once:true});
 // The producer handles its own rejection; consumption observes the stored failure.
 const produce=async()=>{
  try{
   while(!closed&&!signal.aborted){
    while(queue.length>=60&&!closed&&!signal.aborted)await wait();
    if(closed||signal.aborted)break;
    const next=await iterator.next();if(closed||signal.aborted||next.done)break;
    const chunk=next.value;
    if(![22050,24000].includes(chunk.rate)||!(chunk.samples instanceof Int16Array)||chunk.samples.length>chunk.rate/10||(!chunk.done&&!chunk.samples.length)||(chunk.done&&chunk.samples.length))throw new Error('Invalid lookahead PCM');
    queue.push(chunk);wake();
   }
  }catch(error){failure=error;}
  finally{finished=true;wake();try{await iterator.return?.();}catch{} }
 };
 void produce();
 try{
  while(true){
   signal.throwIfAborted();if(failure)throw failure;
   if(queue.length){const value=queue.shift()!;wake();yield value;continue;}
   if(finished)return;
   await wait();
  }
 }finally{closed=true;queue.length=0;signal.removeEventListener('abort',wake);wake();}
}
