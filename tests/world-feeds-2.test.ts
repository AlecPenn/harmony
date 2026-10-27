import {expect,it} from 'vitest';
import {parseFaa,parseKev,worldRoute,nearby,WorldFeeds} from '../core/world-feeds.ts';

const FAA=`<AIRPORT_STATUS_INFORMATION><Update_Time>Thu Oct 22 12:30:01 2026 GMT</Update_Time>
<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><listLength>1</listLength><Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>1 hour and 5 minutes</Avg><Max>2 hours and 7 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type>
<Delay_type><Name>Ground Stops</Name><Ground_Stop_List><listLength>1</listLength><Program><ARPT>EWR</ARPT><Reason>thunderstorms</Reason><End_Time>3:45 pm EDT</End_Time></Program></Ground_Stop_List></Delay_type>
<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><listLength>1</listLength><Delay><ARPT>MSN</ARPT><Reason>WX:Wind</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>
<Delay_type><Name>Airport Closures</Name><Airport_Closure_List><listLength>1</listLength><Airport><ARPT>XYZ</ARPT><Reason>!XYZ 10/123 XYZ AD AP CLSD</Reason><Start>Oct 22 at 10:00 UTC.</Start><Reopen>Oct 23 at 02:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type>
</AIRPORT_STATUS_INFORMATION>`;

it('FAA: ground delays, ground stops, delays and closures, pinned where the airport is known',()=>{
 const ev=parseFaa(FAA);
 expect(ev.map(e=>e.title)).toEqual(['SFO: ground delay program','EWR: ground stop','MSN: departure delays','XYZ: closed']);
 expect(ev[0]).toMatchObject({detail:'low ceilings; average 1 hour and 5 minutes, up to 2 hours and 7 minutes',severity:.6,lat:37.62});
 expect(ev[1].detail).toBe('thunderstorms; until 3:45 pm EDT');
 expect(ev[2]).toMatchObject({detail:'WX:Wind; 16 minutes to 30 minutes, increasing',lat:43.14,lon:-89.34});
 expect(ev[3]).toMatchObject({detail:'10/123 XYZ AD AP CLSD; reopens Oct 23 at 02:00 UTC.',lat:null,severity:.8});
 expect(parseFaa('<AIRPORT_STATUS_INFORMATION></AIRPORT_STATUS_INFORMATION>')).toEqual([]);
 expect(parseFaa('not xml')).toEqual([]);
 // Near Madison: MSN shows, SFO doesn't.
 expect(nearby(ev,{lat:43.07,lon:-89.4,radiusKm:400,name:'Madison'}).map(e=>e.title)).toEqual(['MSN: departure delays']);
});
it('CISA KEV: the last two weeks, software you use first, ransomware noted',()=>{
 const now=Date.parse('2026-10-22T12:00:00Z');
 const v=(id:string,vendor:string,product:string,added:string,ransom='Unknown')=>({cveID:id,vendorProject:vendor,product,vulnerabilityName:'x',dateAdded:added,shortDescription:`${product} flaw.`,requiredAction:'Apply vendor updates.',dueDate:'2026-11-12',knownRansomwareCampaignUse:ransom,notes:''});
 const ev=parseKev({vulnerabilities:[v('CVE-2026-1','Acme','Router','2026-10-20'),v('CVE-2026-2','Microsoft','Windows','2026-10-21'),v('CVE-2026-3','Fortinet','FortiOS','2026-10-19','Known'),v('CVE-2025-9','Old','Thing','2026-09-01'),v('<script>','x','y','bad')]},now);
 expect(ev.map(e=>e.title)).toEqual(['CVE-2026-2: Microsoft Windows being exploited (software you use)','CVE-2026-3: Fortinet FortiOS being exploited','CVE-2026-1: Acme Router being exploited']);
 expect(ev[1].detail).toMatch(/Used by ransomware\. Fix: Apply vendor updates\./);
 expect(ev[0].url).toBe('https://nvd.nist.gov/vuln/detail/CVE-2026-2');
 expect(parseKev(null,now)).toEqual([]);
});
it('routes the new questions, and fetches each feed once with failures as notes',async()=>{
 expect(worldRoute('any flight delays at the airport?',false)?.kinds).toEqual(['airport']);
 expect(worldRoute('is there a ground stop in Chicago',true)?.kinds).toEqual(['airport']);
 expect(worldRoute('what vulnerabilities are being exploited right now',false)?.kinds).toEqual(['cyber']);
 expect(worldRoute('any new ransomware?',false)?.label).toBe('actively exploited vulnerabilities');
 const urls:string[]=[];
 const feeds=new WorldFeeds({now:()=>Date.parse('2026-10-22T12:00:00Z'),fetch:(async(u:string)=>{urls.push(String(u));return String(u).includes('faa')?new Response(FAA):new Response('nope',{status:503});}) as never});
 expect((await feeds.feed('airport')).events).toHaveLength(4);await feeds.feed('airport');expect(urls).toHaveLength(1); // cached
 expect(await feeds.feed('cyber')).toMatchObject({ok:false,note:'The CISA exploited-vulnerability list is unavailable right now.'});
});
