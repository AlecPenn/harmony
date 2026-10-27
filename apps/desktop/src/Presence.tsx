import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Box3, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshStandardMaterial, MeshPhysicalMaterial, Object3D, PMREMGenerator, Quaternion, ShaderMaterial, TorusGeometry, Vector2, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { presenceProfiles, type PresenceMode } from './presence-model.ts';

const vertex = `
varying vec3 vPosition; varying vec3 vNormal; varying vec3 vWorld;
void main(){ vPosition=position; vNormal=normalize(normalMatrix*normal);
 vec4 world=modelViewMatrix*vec4(position,1.); vWorld=world.xyz; gl_Position=projectionMatrix*world; }
`;
const fragment = `
uniform float uTime; uniform float uEnergy; uniform float uPink; uniform float uBlue;
varying vec3 vPosition; varying vec3 vNormal; varying vec3 vWorld;
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float n=0.;float a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+3.1;a*=.5;}return n;}
void main(){
 vec3 p=vPosition*2.8; float t=uTime;
 vec3 warp=vec3(fbm(p+vec3(t*.2,0,0)),fbm(p.yzx+vec3(0,t*.16,4)),fbm(p.zxy+vec3(2,0,-t*.12)));
 float flow=fbm(p+warp*3.8+vec3(0,t*.12,0));
 float vein=sin(flow*16.+warp.y*4.+t*.1)*.5+.5;
 vec3 purple=vec3(.24,.012,.65); vec3 blue=vec3(.012,.24,.95); vec3 pink=vec3(.95,.015,.37);
 vec3 col=mix(purple,blue,smoothstep(.28,.7,warp.x)*(.5+uBlue*.5));
 col=mix(col,pink,smoothstep(.35,.73,flow)*(.35+uPink*.55));
 float rim=pow(1.-max(dot(normalize(vNormal),normalize(-vWorld)),0.),2.8);
 float strand=pow(vein,24.); col+=(vec3(.5,.72,1.)*strand*.22+rim*vec3(.2,.2,.5));
 float light=.45+.65*max(dot(normalize(vNormal),normalize(vec3(-1.,2.,3.))),0.);
 gl_FragColor=vec4(col*light*uEnergy+strand*vec3(.18,.1,.23),.96);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

function Core({ mode, still, ornate }: { mode: PresenceMode; still: boolean; ornate: boolean }) {
  // ornate: the Blender model is showing, so only the starfield and a soft backdrop are drawn here.
  const group = useRef<Group>(null); const rings = useRef<Group>(null);
  const material = useMemo(() => new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment,
    uniforms: { uTime: { value: 3 }, uEnergy: { value: .5 }, uPink: { value: .35 }, uBlue: { value: .45 } }
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  const positions = useMemo(() => {
    const array = new Float32Array(240 * 3);
    for (let i=0;i<240;i++) {
      const angle=i*2.399963; const radius=1.65+((i*37)%100)/55;
      array[i*3]=Math.cos(angle)*radius; array[i*3+1]=Math.sin(angle)*radius*.75;
      array[i*3+2]=Math.sin(i*7.7)*1.8-1.5;
    }
    return array;
  }, []);
  const profile = presenceProfiles[mode];
  const targetScale=useMemo(()=>new Vector3(),[]);
  useFrame((_state, delta) => {
    material.uniforms.uEnergy.value=profile.energy; material.uniforms.uPink.value=profile.pink; material.uniforms.uBlue.value=profile.blue;
    if (still) return;
    const step=Math.min(delta,.05); material.uniforms.uTime.value+=step*profile.speed;
    if (group.current) group.current.rotation.y+=step*profile.speed*.13;
    if (rings.current) {
      rings.current.rotation.z+=step*profile.speed*.08;
      const target=mode==='listening' ? .93 : mode==='speaking' ? 1.06 : 1;
      rings.current.scale.lerp(targetScale.setScalar(target), .04);
    }
  });
  return <group ref={group}>
    <mesh visible={!ornate}><sphereGeometry args={[1, 64, 48]} /><primitive object={material} attach="material" /></mesh>
    <mesh scale={1.018} visible={!ornate}><sphereGeometry args={[1,48,32]} /><meshPhysicalMaterial color="#8878ff" transparent opacity={.13} roughness={.12} metalness={.05} clearcoat={1} transmission={.12} thickness={.35} ior={1.35} depthWrite={false} /></mesh>
    <group ref={rings} visible={!ornate}>
      {[[1.42,.4,.25,'#627cff'],[1.58,1.05,-.6,'#b02fff'],[1.78,1.3,.6,'#ff299e']].map(([radius,x,z,color], i) => <mesh key={i} rotation={[Number(x),.3,Number(z)]}>
        <torusGeometry args={[Number(radius),.006,8,180]} /><meshBasicMaterial color={String(color)} transparent opacity={mode==='offline'?.16:.6} />
      </mesh>)}
    </group>
    <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions,3]} /></bufferGeometry><pointsMaterial color={mode==='thinking'?'#ef70d7':'#8fb4ff'} size={.012} transparent opacity={.65} depthWrite={false} blending={AdditiveBlending} /></points>
    <mesh position={[0,0,-.65]} scale={2.3}><planeGeometry args={[2,2]} /><shaderMaterial transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide}
      vertexShader={`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`}
      fragmentShader={`varying vec2 vUv;void main(){float d=length(vUv-.5)*2.;float glow=pow(max(0.,1.-d),3.);gl_FragColor=vec4(.22,.035,.5,glow*.26);}`} /></mesh>
  </group>;
}


const NOISE=`float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float n=0.;float a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+3.1;a*=.5;}return n;}
float level(vec3 p,float t,float slosh){return .62+slosh*(.035*sin(p.x*7.+t*2.1)+.025*sin(p.z*9.-t*1.7)+.015*sin((p.x+p.z)*13.+t*3.3));}`;
const fluidVertex=`uniform float uTime;uniform float uSlosh;uniform float uSurface;varying vec3 vLocal;varying vec3 vNormal;varying vec3 vView;
${NOISE}
void main(){vec3 p=position;if(uSurface>.5)p.y=level(p,uTime,uSlosh);vLocal=p;vNormal=normalize(normalMatrix*normal);
 vec4 mv=modelViewMatrix*vec4(p,1.);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`;
const fluidFragment=`uniform float uTime;uniform float uEnergy;uniform float uSlosh;uniform float uSurface;varying vec3 vLocal;varying vec3 vNormal;varying vec3 vView;
${NOISE}
void main(){
 vec3 p=vLocal;float t=uTime;
 if(uSurface<.5&&p.y>level(p,t,uSlosh))discard;
 // Slow glowing currents rising through the fluid.
 vec3 q=p*3.2+vec3(0.,-t*.35,0.);
 vec3 warp=vec3(fbm(q+vec3(t*.15,0.,0.)),fbm(q.yzx+vec3(0.,0.,t*.12)),fbm(q.zxy+4.));
 float flow=fbm(q+warp*2.6);
 float streak=pow(sin(flow*14.+warp.y*5.)*.5+.5,10.);
 vec3 deep=vec3(.32,.0,.2),neon=vec3(1.,.04,.5),hot=vec3(1.,.45,.85);
 vec3 col=mix(deep,neon,smoothstep(.25,.75,flow));
 col+=hot*streak*.4;
 float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.2);
 col+=neon*rim*.9;
 if(uSurface>.5)col=mix(col,hot,.2+.15*sin(length(p.xz)*30.-t*4.));
 float depth=smoothstep(-1.1,.6,p.y);col*=.75+.45*depth;
 gl_FragColor=vec4(col*(.58+uEnergy*.5),uSurface>.5?.85:.66);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const bubbleVertex=`uniform float uTime;attribute vec4 seed;varying float vFade;
void main(){float range=1.6;float y=mod(seed.y*1.43+uTime*(.18+seed.w*.22),range)-1.;
 float r=seed.x*.5;float a=seed.z*6.2831+uTime*.6*(seed.w-.5)+y*3.;
 vec3 p=vec3(cos(a)*r+.025*sin(uTime*3.+seed.z*20.),y,sin(a)*r);
 vFade=smoothstep(-1.,-.85,y)*(1.-smoothstep(.5,.6,y));
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=(2.+seed.w*5.)*(6./-mv.z);gl_Position=projectionMatrix*mv;}`;
const bubbleFragment=`varying float vFade;void main(){vec2 c=gl_PointCoord-.5;float d=length(c);if(d>.5)discard;
 float ring=smoothstep(.5,.32,d)*(.35+.65*smoothstep(.2,.45,d));gl_FragColor=vec4(vec3(1.,.82,.95)*ring,ring*vFade*.9);}`;
const glassFragment=`varying vec3 vNormal;varying vec3 vView;void main(){float f=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),3.);
 float streak=smoothstep(.62,.66,normalize(vNormal).x)*.18;gl_FragColor=vec4(vec3(.85,.9,1.)*(f*.85+streak),f*.6+streak);}`;
const glassVertex=`varying vec3 vNormal;varying vec3 vView;void main(){vNormal=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`;

/** Plasma: a ribbon of flowing pink-violet energy with a hot white core, in place of a gold ring. Torus uv: x runs
 * around the ring, y around the tube; the glow fades towards the tube's edge so it reads as light, not metal. */
const plasmaVertex=`varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;void main(){vUv=uv;vNormal=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`;
const plasmaFragment=`uniform float uTime;uniform float uEnergy;uniform float uShell;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
${NOISE}
void main(){
 float a=vUv.x*6.2831853,t=uTime;
 vec3 q=vec3(cos(a)*2.2,sin(a)*2.2,vUv.y*1.3)+vec3(t*.55,-t*.4,t*.3);
 float flow=fbm(q+fbm(q*1.7+t*.2)*1.8);
 float filament=pow(sin(vUv.x*60.-t*5.+flow*11.+sin(vUv.y*6.2831+t)*2.)*.5+.5,6.)*smoothstep(.35,.7,flow);
 float knots=smoothstep(.62,.9,fbm(vec3(cos(a)*5.,sin(a)*5.,t*.8)));
 float edge=pow(abs(dot(normalize(vNormal),normalize(vView))),uShell>.5?1.6:.7);
 vec3 violet=vec3(.55,.18,1.),pink=vec3(1.,.16,.62),hot=vec3(1.,.82,.95);
 vec3 col=mix(violet,pink,smoothstep(.3,.7,flow))+hot*(filament*.9+knots*.7);
 float alpha=edge*(uShell>.5?.2:.95)*(.45+.55*flow+knots*.4)*(.7+uEnergy*.45);
 gl_FragColor=vec4(col*alpha,alpha);
}`;
function usePlasma(){
  const core=useMemo(()=>new ShaderMaterial({vertexShader:plasmaVertex,fragmentShader:plasmaFragment,transparent:true,depthWrite:false,blending:AdditiveBlending,uniforms:{uTime:{value:0},uEnergy:{value:.5},uShell:{value:0}}}),[]);
  const shell=useMemo(()=>{const m=core.clone();m.uniforms.uShell.value=1;return m;},[core]);
  useEffect(()=>()=>{core.dispose();shell.dispose();},[core,shell]);
  return [core,shell] as const;
}

/** The heart: a glass tank of glowing neon-pink fluid with rising bubbles, gold collars, and a pink light that shines
 * on the gold rings. The fluid sloshes and brightens with HARMONY's state (listening, thinking, speaking). */
function GlassTank({ mode, still }: { mode: PresenceMode; still: boolean }) {
  const profile=presenceProfiles[mode];
  const fluid=useMemo(()=>new ShaderMaterial({vertexShader:fluidVertex,fragmentShader:fluidFragment,transparent:true,depthWrite:false,side:DoubleSide,
    uniforms:{uTime:{value:2},uEnergy:{value:.5},uSlosh:{value:1},uSurface:{value:0}}}),[]);
  const surface=useMemo(()=>{const m=fluid.clone();m.uniforms.uSurface.value=1;return m;},[fluid]);
  const bubbles=useMemo(()=>new ShaderMaterial({vertexShader:bubbleVertex,fragmentShader:bubbleFragment,transparent:true,depthWrite:false,blending:AdditiveBlending,uniforms:{uTime:{value:0}}}),[]);
  const glass=useMemo(()=>new ShaderMaterial({vertexShader:glassVertex,fragmentShader:glassFragment,transparent:true,depthWrite:false,blending:AdditiveBlending,side:DoubleSide}),[]);
  const seeds=useMemo(()=>{const a=new Float32Array(90*4);for(let i=0;i<90;i++){a[i*4]=Math.sqrt(((i*53)%97)/97);a[i*4+1]=((i*37)%101)/101*1.12;a[i*4+2]=((i*71)%89)/89;a[i*4+3]=((i*29)%83)/83;}return a;},[]);
  const glow=useRef<import('three').PointLight>(null);
  // The surface disc lies flat in its own coordinates (y is height), so the shader can ripple it.
  const surfaceDisc=useMemo(()=>{const g=new CircleGeometry(.598,64,0);g.rotateX(-Math.PI/2);return g;},[]);
  useEffect(()=>()=>{fluid.dispose();surface.dispose();bubbles.dispose();glass.dispose();surfaceDisc.dispose();},[fluid,surface,bubbles,glass,surfaceDisc]);
  const rise=useRef<Group>(null);
  useFrame((_s,delta)=>{
    if(rise.current&&rise.current.scale.x<.999){const e=rise.current.scale.x;rise.current.scale.setScalar(still?1:Math.min(1,e+(1.02-e)*Math.min(1,delta*3)));}
    const slosh=mode==='speaking'?1.8:mode==='thinking'?1.4:mode==='listening'?1.15:1;
    for(const m of [fluid,surface]){m.uniforms.uEnergy.value=profile.energy;m.uniforms.uSlosh.value+=(slosh-m.uniforms.uSlosh.value)*.05;}
    if(glow.current)glow.current.intensity=3+profile.energy*4+(mode==='speaking'?Math.sin(performance.now()/90):0);
    if(still)return;
    const step=Math.min(delta,.05)*(.8+profile.speed*1.5);
    fluid.uniforms.uTime.value+=step;surface.uniforms.uTime.value=fluid.uniforms.uTime.value;bubbles.uniforms.uTime.value+=step;
  });
  const gold=<meshStandardMaterial color="#e8b75a" metalness={1} roughness={.22} envMapIntensity={1.2}/>;
  return <group ref={rise} scale={.01}>
    <pointLight ref={glow} color="#ff3fb4" intensity={5} distance={4.5} decay={1.6}/>
    {/* Fluid body (clipped at its rippling surface) and the surface itself. */}
    <mesh><capsuleGeometry args={[.6,.8,12,48]}/><primitive object={fluid} attach="material"/></mesh>
    <mesh geometry={surfaceDisc}><primitive object={surface} attach="material"/></mesh>
    <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array(90*3),3]}/><bufferAttribute attach="attributes-seed" args={[seeds,4]}/></bufferGeometry><primitive object={bubbles} attach="material"/></points>
    {/* Glass: a clear shell with bright edges and a catch-light streak. */}
    <mesh><capsuleGeometry args={[.66,.8,12,48]}/><primitive object={glass} attach="material"/></mesh>
    <mesh><capsuleGeometry args={[.66,.8,12,48]}/><meshPhysicalMaterial color="#ffffff" transparent opacity={.07} roughness={.03} clearcoat={1} envMapIntensity={1.6} depthWrite={false}/></mesh>
    {/* Gold collars where glass meets metal. */}
    {[.4,-.4].map(y=><mesh key={y} position={[0,y,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.67,.03,12,64]}/>{gold}</mesh>)}
    {[1.07,-1.07].map(y=><mesh key={y} position={[0,y,0]} rotation={[y<0?Math.PI:0,0,0]}><cylinderGeometry args={[.14,.24,.1,32]}/>{gold}</mesh>)}
  </group>;
}

/** The model's bytes are fetched once, as soon as this file loads, and shared by every window and re-mount. */
let modelBytes:Promise<Uint8Array>|null=null;
function coreModel():Promise<Uint8Array>{
  if(!modelBytes){modelBytes=window.harmony?.model?window.harmony.model('harmony-core'):Promise.reject(new Error('no bridge'));modelBytes.catch(()=>{modelBytes=null;});}
  return modelBytes;
}
try{void coreModel().catch(()=>{});}catch{}

/** The Blender-built ornament (apps/desktop/public/models/harmony-core.glb, source in assets-src/harmony-core.blend):
 * gold armillary rings, crystal cage, H medallion, halo and finials around the live plasma core. Loaded on its own, so if
 * it is missing or fails, the core still shows. Glass is drawn as simple transparency (no costly transmission pass). */
function Ornament({ mode, still, onReady }: { mode: PresenceMode; still: boolean; onReady:(ok:boolean)=>void }) {
  const { scene, gl, invalidate } = useThree(); const [root,setRoot]=useState<Object3D|null>(null);const plasma=usePlasma();
  const parts=useRef<Record<string,Object3D|undefined>>({}); const glows=useRef<MeshStandardMaterial[]>([]);
  useEffect(()=>{
    let cancelled=false;const pmrem=new PMREMGenerator(gl);const env=pmrem.fromScene(new RoomEnvironment(),0.04).texture;scene.environment=env;
    const load=coreModel();
    load.then(bytes=>new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>((resolve,reject)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'',resolve,reject))).then(gltf=>{
      if(cancelled)return;const model=gltf.scene;model.rotation.x=.16;// tilt so the halo reads as an ellipse
      model.traverse(o=>{const m=(o as Mesh).material as MeshPhysicalMaterial|undefined;if(!m||!(o as Mesh).isMesh)return;
        if(m.transmission>0){m.transmission=0;m.transparent=true;m.opacity=Math.min(m.opacity,.42);m.depthWrite=false;}
        // Blender's emission strengths are tuned for Cycles/EEVEE; these suit the bloom pass here.
        m.envMapIntensity=m.metalness>.5?.72:.55;
        const base=({H_BlueGlow:1.0,H_PinkEnamel:.36,H_VioletEnamel:.08,H_PinkGem:.34,H_BlueGem:.34,H_Pearl:.03,H_PurpleGlass:.1} as Record<string,number>)[m.name];
        if(base!==undefined){m.emissiveIntensity=base;m.userData.baseGlow=base;if(base>=.5)glows.current.push(m);}});
      for(const n of ['ringA','ringB','ringC','halo','cage','equator','medallion'])parts.current[n]=model.getObjectByName(n);
      for(const n of ['ringA','ringB','ringC']){const r=parts.current[n];if(r)r.userData.base=r.quaternion.clone();}
      // The purple glass panes made the centre look solid; the gold cage now holds the glass tank instead.
      const panes=model.getObjectByName('cage_glass');if(panes)panes.visible=false;
      // The gold H now floats inside the tank (its enamel disc is left out so the fluid shows through).
      const med=model.getObjectByName('medallion');if(med){med.position.set(0,0,0);med.scale.setScalar(.85);}
      for(const n of ['med_face','med_glow','med_ticks']){const o=model.getObjectByName(n);if(o)o.visible=false;}
      // Fewer rings: the wide halo goes, and the middle gold ring becomes a ring of plasma (same size and spin).
      const halo=model.getObjectByName('halo');if(halo)halo.visible=false;
      const ringB=model.getObjectByName('ringB'),band=model.getObjectByName('ringB_band') as Mesh|undefined;
      if(ringB&&band?.geometry){
        band.geometry.computeBoundingBox();const size=band.geometry.boundingBox!.getSize(new Vector3());
        const thin=size.x<=size.y&&size.x<=size.z?'x':size.y<=size.z?'y':'z',radius=Math.max(size.x,size.y,size.z)/2;
        for(const c of [...ringB.children])c.visible=false;
        const holder=new Group();holder.name='ringB_plasma';holder.position.copy(band.position);holder.quaternion.copy(band.quaternion);holder.scale.copy(band.scale);
        if(thin==='x')holder.rotateY(Math.PI/2);else if(thin==='y')holder.rotateX(Math.PI/2);
        const tube=Math.max(.045,Math.min(size.x,size.y,size.z)*1.4);
        holder.add(new Mesh(new TorusGeometry(radius,tube,20,260),plasma[0]),new Mesh(new TorusGeometry(radius,tube*2.4,20,260),plasma[1]));
        ringB.add(holder);
      }
      setRoot(model);onReady(true);invalidate();
    }).catch(()=>{if(!cancelled)onReady(false);});
    return ()=>{cancelled=true;scene.environment=null;env.dispose();pmrem.dispose();};
  },[gl,scene,invalidate,onReady,plasma]);
  const profile=presenceProfiles[mode];const target=useMemo(()=>new Vector3(),[]);const entrance=useRef<Group>(null);
  const clock=useRef(0),axis=useMemo(()=>new Vector3(),[]),qTilt=useMemo(()=>new Quaternion(),[]);
  useFrame((_s,delta)=>{
    const p=parts.current;if(!root)return;
    if(entrance.current&&entrance.current.scale.x<.999){const e=entrance.current.scale.x;entrance.current.scale.setScalar(still?1:Math.min(1,e+(1.02-e)*Math.min(1,delta*4)));}
    for(const m of glows.current)m.emissiveIntensity=(m.userData.baseGlow as number)*(.55+profile.energy*.7);
    for(const m of plasma)m.uniforms.uEnergy.value=profile.energy;
    if(still)return;
    plasma[0].uniforms.uTime.value+=Math.min(delta,.05)*(.6+profile.speed*1.4);plasma[1].uniforms.uTime.value=plasma[0].uniforms.uTime.value;
    // Always visibly alive: a steady base speed, faster when she listens, thinks or speaks.
    const step=Math.min(delta,.05)*(.7+profile.speed*1.6);
    // Each ring flips like a coin around the centre: it turns about one of its own diameters. Every ring flips about a
    // different diameter, at its own pace and in its own direction, so they cross and pass each other and never sync.
    clock.current+=step;const t=clock.current;
    RING_MOTION.forEach(([name,angle,speed,phase])=>{
      const r=p[name];const base=r?.userData.base as Quaternion|undefined;if(!r||!base)return;
      axis.set(Math.cos(angle),0,Math.sin(angle));qTilt.setFromAxisAngle(axis,t*speed+phase);
      r.quaternion.copy(base).multiply(qTilt);
    });
    if(p.halo)p.halo.rotation.y+=step*.05; if(p.medallion)p.medallion.rotation.z+=step*.3; if(p.cage)p.cage.rotation.y-=step*.12; if(p.equator)p.equator.rotation.y+=step*.4;
    const s=mode==='listening'?.95:mode==='speaking'?1.04:mode==='thinking'?1.01:1;
    for(const k of ['ringA','ringB','ringC'])p[k]?.scale.lerp(target.setScalar(s),.05);
  });
  return root?<group ref={entrance} scale={.01}><primitive object={root}/></group>:null;
}
/** [ring, which diameter it flips about (radians around the ring), flip speed (radians per second at rest; negative
 * flips the other way), starting offset]. She flips them a little faster while listening, thinking and speaking. */
const RING_MOTION:[string,number,number,number][]=[['ringA',0,.34,0],['ringB',2.2,-.26,1.9],['ringC',4.1,.2,3.7]];
/** Frames are drawn on a steady timer instead of at the screen's refresh rate (a 144 Hz monitor would draw 144 a second,
 * and with the mini orb, the floating window and an animated wallpaper the GPU never rests). */
function Budget({ still, constrained, fps }: { still: boolean; constrained:boolean; fps:number }) {
  const { setDpr, gl, invalidate } = useThree(); const samples=useRef({count:0,total:0,reduced:false});
  useEffect(() => {
    invalidate();
    if(still)return;
    const timer=setInterval(()=>invalidate(),1000/(constrained?15:fps));return()=>clearInterval(timer);
  }, [still,constrained,fps,invalidate]);
  useFrame((_s,delta) => {
    const value=samples.current;
    if(still || constrained || value.reduced) return;
    value.total+=delta; value.count++;
    if(value.count===90) {
      if(value.total/value.count>1.35/fps) { setDpr(.75); value.reduced=true; gl.domElement.dataset.quality='reduced'; }
      value.count=0; value.total=0;
    }
  });
  return null;
}
function Bloom() {
  const { gl, scene, camera, size }=useThree();
  const composer=useMemo(()=>{
    const pipeline=new EffectComposer(gl);
    pipeline.addPass(new RenderPass(scene,camera));
    pipeline.addPass(new UnrealBloomPass(new Vector2(256,256),.24,.45,.8));
    pipeline.addPass(new OutputPass());
    return pipeline;
  },[gl,scene,camera]);
  useEffect(()=>{composer.setPixelRatio(1);composer.setSize(Math.min(size.width,640),Math.min(size.height,540));},[composer,size]);
  useEffect(()=>()=>{for(const pass of composer.passes) pass.dispose();composer.dispose();},[composer]);
  useFrame(()=>{
    if(gl.domElement.dataset.quality==='reduced') gl.render(scene,camera);
    else composer.render();
  },1);
  return null;
}
function StaticCore() { return <div className="static-core" data-testid="presence-fallback"><span>H</span></div>; }
class PresenceBoundary extends Component<{ children: ReactNode }, { failed:boolean }> {
  state={failed:false}; static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed ? <StaticCore/> : this.props.children;}
}
export default function Presence({ mode, reducedMotion, transparent = false, resourceConstrained=false }: { mode: PresenceMode; reducedMotion: boolean; transparent?: boolean;resourceConstrained?:boolean }) {
  const [lost,setLost]=useState(false); const [visible,setVisible]=useState(!document.hidden); const [ornate,setOrnate]=useState<boolean|null>(null);
  useEffect(() => { const change=()=>setVisible(!document.hidden); document.addEventListener('visibilitychange',change); return ()=>document.removeEventListener('visibilitychange',change); },[]);
  const still=reducedMotion||!visible||mode==='stopped'||mode==='offline';
  // Nothing is shown until the model is ready (or has failed), then everything fades in together: no old look first.
  return <div className="presence" data-ready={ornate===null?'no':'yes'} data-mode={mode} data-motion={still?'still':'animated'} data-budget={resourceConstrained?'processing':'normal'} aria-hidden="true">
    <div className="binary-rain">{Array.from({length:8},(_,i)=><span key={i} style={{left:`${8+i*12}%`,animationDelay:`-${i*2.7}s`}}>01<br/>10<br/>01<br/>00<br/>11<br/>01</span>)}</div>
    {lost ? <StaticCore/> : <PresenceBoundary><Suspense fallback={null}>
      <Canvas camera={{position:[0,0,6.3],fov:45}} dpr={resourceConstrained?.75:transparent?[.75,1]:[.75,1.25]} frameloop="demand" gl={{antialias:false,powerPreference:'low-power'}} fallback={<StaticCore/>}
        onCreated={({gl})=>{gl.setClearColor(new Color('#050610'),0); gl.domElement.dataset.quality='standard'; gl.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();setLost(true);},{once:true});}}>
        <ambientLight intensity={.4}/><pointLight position={[-3,3,3]} color="#688bff" intensity={12}/><pointLight position={[3,-2,2]} color="#ff299e" intensity={8}/>
        {ornate!==null&&<Core mode={mode} still={still} ornate={ornate}/>}<Ornament mode={mode} still={still} onReady={setOrnate}/>{ornate===true&&<GlassTank mode={mode} still={still}/>}<Budget still={still} constrained={resourceConstrained} fps={transparent?24:40}/>{!transparent && !resourceConstrained && <Bloom/>}
      </Canvas>
    </Suspense></PresenceBoundary>}
    {!lost && ornate===false && <span className="core-monogram">H</span>}
  </div>;
}
