import {useEffect,useState} from 'react';

/** Set the private home used for local information. */
export function HomePanel(){
 const [place,setPlace]=useState(''),[lat,setLat]=useState(''),[lon,setLon]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{void window.harmony?.home({op:'get'}).then(home=>{if(home){setPlace(home.place);setLat(home.lat?.toString()??'');setLon(home.lon?.toString()??'');}}).catch(()=>setMessage('Could not read your home town.'));},[]);
 const save=async()=>{
  setMessage('');setBusy(true);
  try{
   if((lat.trim()==='')!==(lon.trim()===''))throw new Error('Enter both coordinates, or leave both blank.');
   const home={place,...(lat.trim()&&lon.trim()?{lat:Number(lat),lon:Number(lon)}:{})};
   await window.harmony!.home({op:'set',home});setMessage('Home town saved on this computer.');
  }catch(e){setMessage(e instanceof Error?e.message:'Could not save your home town.');}finally{setBusy(false);}
 };
 return <section><p className="eyebrow">HOME</p><h3>Your town</h3><p className="panel-intro">Used for local information. Saved privately on this computer.</p>
  <label className="setting"><span>Town or city</span><input value={place} maxLength={120} onChange={e=>setPlace(e.target.value)} placeholder="City, region"/></label>
  <label className="setting"><span>Latitude (optional)</span><input type="number" min="-90" max="90" step="any" value={lat} onChange={e=>setLat(e.target.value)}/></label>
  <label className="setting"><span>Longitude (optional)</span><input type="number" min="-180" max="180" step="any" value={lon} onChange={e=>setLon(e.target.value)}/></label>
  <button className="text-button" disabled={busy} onClick={()=>void save()}>Save home town</button><p role="status">{message}</p>
 </section>;
}
