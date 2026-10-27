import {expect,it} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {SpeedScoreboard,quantile,classify} from '../core/speed-scoreboard.ts';

it('quantiles and kinds',()=>{
 expect(quantile([],.5)).toBeNull();expect(quantile([1000,3000,2000],.5)).toBe(2000);expect(quantile([1,2,3,4,5,6,7,8,9,10],.9)).toBe(9);
 expect(classify({fixed:true,shortcut:false,guest:false,toolMs:null})).toBe('instant');
 expect(classify({fixed:false,shortcut:true,guest:false,toolMs:5})).toBe('shortcut');
 expect(classify({fixed:false,shortcut:false,guest:false,toolMs:300})).toBe('lookup');
 expect(classify({fixed:false,shortcut:false,guest:true,toolMs:null})).toBe('guest');
 expect(classify({fixed:false,shortcut:false,guest:false,toolMs:null})).toBe('brain');
});
it('scores each build against the targets and says whether the speed pass helped',()=>{
 const db=openDatabase(':memory:');let build='aaaaaaa';const b=new SpeedScoreboard(db,()=>build,()=>new Date('2026-10-22T15:00:00Z'));
 expect(b.board().summary).toMatch(/No timed replies yet/);
 const t=(stt:number,words:number,audio:number,tool:number|null=null)=>({sttMs:stt,firstWordsMs:words,firstAudioMs:audio,playbackStartMs:audio+50,toolMs:tool,at:''});
 for(const a of [1400,1500,1600,1700,2600])b.record(t(300,1000,a),'brain');
 b.record(t(300,2100,2500,600),'lookup');b.startup(6200);
 build='bbbbbbb';
 for(const a of [900,1000,1100,1200,1900])b.record(t(250,700,a),'brain');
 b.record(t(250,1800,2200,500),'lookup');b.startup(4300);b.record(t(0,0,-5),'brain');
 const [old,now]=b.scores();
 expect(old).toMatchObject({build:'aaaaaaa',n:6,kinds:{brain:{n:5,median:1600,met:0,target:1200}},startup:{median:6200}});
 expect(now.kinds.brain).toMatchObject({n:5,median:1100,met:80}); // the impossible timing (negative) is left out
 expect(now.kinds.lookup).toMatchObject({median:1800,met:100});
 expect(now.stages.voice).toBe(400);
 const s=b.board().summary;
 expect(s).toMatch(/^Speed on this build \(7 replies\): Short replies: first audio 1\.1 s typical/);
 expect(s).toMatch(/31% faster than the build before\./);expect(s).toMatch(/Start to ready: 4\.3 s\./);
 expect(s).toMatch(/the slowest stage is the brain thinking/);
});
