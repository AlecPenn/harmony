import {createElement} from 'react';
import {test,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {LatencyPanel} from '../apps/desktop/src/LatencyPanel.tsx';
import {emptyVoiceOutput,type VoiceOutputStatus} from '../packages/contracts/voice-output.ts';
const voice:VoiceOutputStatus={...emptyVoiceOutput,provider:'local',localEngine:'kokoro',state:'READY',preparation:[
 {stage:'model',elapsedMs:0},{stage:'acknowledgements',elapsedMs:20000},{stage:'warmup',elapsedMs:28000},{stage:'ready',elapsedMs:33000},
]};
test('preparation displays stage durations separately from total and first-audio latency',()=>{
 const html=renderToStaticMarkup(createElement(LatencyPanel,{trace:null,voice}));
 for(const value of ['20000 ms','8000 ms','5000 ms','Worker ready after 33000 ms','excludes process launch overhead'])expect(html).toContain(value);
 expect(html).not.toContain('In progress');
});
test('unfinished or interrupted preparation never shows a fabricated duration or readiness',()=>{
 const partial={...voice,state:'PREPARING' as const,preparation:voice.preparation!.slice(0,2)};
 expect(renderToStaticMarkup(createElement(LatencyPanel,{trace:null,voice:partial}))).toContain('In progress');
 const cancelled=renderToStaticMarkup(createElement(LatencyPanel,{trace:null,voice:{...partial,state:'CANCELLED'}}));
 expect(cancelled).toContain('Not completed');expect(cancelled).not.toContain('Worker ready after');
 expect(renderToStaticMarkup(createElement(LatencyPanel,{trace:null}))).not.toContain('Local voice preparation timing');
});
