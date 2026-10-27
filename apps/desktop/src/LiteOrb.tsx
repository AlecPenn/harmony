import type {PresenceMode} from './presence-model.ts';

/** Step 30: a light HARMONY for the small windows (the mini orb). The same idea as the 3D presence (a glowing core in
 * three gold rings that flip like coins, each about its own axis) drawn with plain CSS, which the graphics card
 * composites almost for free, instead of a second 3D view. */
export function LiteOrb({mode}:{mode:PresenceMode}){
 return <div className="lite-orb" data-mode={mode} aria-hidden="true">
  <div className="lite-stage">
   <span className="lite-ring r1"/><span className="lite-ring r2"/><span className="lite-ring r3"/>
   <span className="lite-core"/>
  </div>
 </div>;
}
