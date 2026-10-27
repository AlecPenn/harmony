import {test,expect} from 'vitest';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
test('overlapping spans retain their own durations and are never summed into elapsed time',()=>{
 let now=0;const p=new LatencyProfiler(()=>now);p.begin('conversation');const a=p.start('stt_ms');now=10;const b=p.start('speaker_id_ms');now=30;p.end(a);now=40;p.end(b);now=50;p.finish('completed');
 const t=p.snapshot()!;expect(t.metrics.stt_ms.ms).toBe(30);expect(t.metrics.speaker_id_ms.ms).toBe(30);expect(t.metrics.full_turn_ms.ms).toBe(50);expect(t.metrics.wake_ms).toEqual({ms:null,state:'unavailable'});
});
test('STOP marks pending spans cancelled and rejects late or cross-turn completions',()=>{
 let now=0;const p=new LatencyProfiler(()=>now);p.begin('conversation');const token=p.start('llm_first_token_ms');now=20;p.finish('cancelled');expect(p.end(token)).toBe(false);expect(p.snapshot()!.metrics.llm_first_token_ms.state).toBe('cancelled');
 p.begin('voice_preview');expect(p.end(token)).toBe(false);expect(p.snapshot()!.spans).toHaveLength(0);
});
test('attempts are bounded and snapshots cannot mutate retained diagnostics',()=>{
 let now=0;const p=new LatencyProfiler(()=>now);p.begin('conversation');for(let i=0;i<100;i++){const token=p.start('tool_complete_ms');now++;p.end(token);}
 const t=p.snapshot()!;expect(t.spans).toHaveLength(64);expect(t.droppedSpans).toBe(36);t.spans.length=0;expect(p.snapshot()!.spans).toHaveLength(64);
});
test('late earlier attempts do not overwrite newer attempt summaries; invalid clocks are rejected',()=>{
 let now=10;const p=new LatencyProfiler(()=>now);p.begin('conversation');const a=p.start('model_router_ms');now=15;const b=p.start('model_router_ms');now=20;p.end(b);now=30;p.end(a);expect(p.snapshot()!.metrics.model_router_ms.ms).toBe(5);
 now=0;expect(()=>p.start('ui_reaction_ms')).toThrow('clock');
});


test('version two exposes all twelve fields without inventing unmeasured stages',()=>{
 const p=new LatencyProfiler(()=>0);p.begin('conversation');const t=p.snapshot()!;
 expect(t.version).toBe(2);expect(Object.keys(t.metrics)).toHaveLength(12);
 expect(t.metrics.intent_ms).toEqual({ms:null,state:'unavailable'});
 expect(t.metrics.tool_start_ms).toEqual({ms:null,state:'unavailable'});
 expect(t.metrics.full_turn_ms).toEqual({ms:null,state:'pending'});
 expect(Object.hasOwn(t.metrics,'tool_ms')).toBe(false);
});
