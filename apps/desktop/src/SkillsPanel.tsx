import type {SkillStatus} from '../../../core/skills.ts';

/** Every skill HARMONY has, with an on/off switch. Turning one off removes its functions from what the brain is offered. */
export function SkillsPanel({skills}:{skills?:SkillStatus[]}){
 if(!skills?.length)return null;
 return <section className="skills-panel">
  <h3>Skills</h3>
  <p className="panel-intro">Also by voice: “What skills do you have?”, “Disable computer control.” Each skill keeps the fixed permissions shown; turning one on never grants more.</p>
  <ul className="memory-list" aria-label="Skills">{skills.map(s=><li key={s.id}>
   <span>{s.name}<small>{s.description}{s.status==='UNAVAILABLE'?' · not set up or connected':''} · v{s.version} · {s.hash}</small></span>
   <label className="skill-toggle"><input type="checkbox" aria-label={`${s.name} on`} checked={s.status==='ENABLED'} disabled={s.core||s.status==='UNAVAILABLE'}
    onChange={e=>{void window.harmony?.setSkill(s.id,e.target.checked).catch(()=>{});}}/></label>
  </li>)}</ul>
 </section>;
}
