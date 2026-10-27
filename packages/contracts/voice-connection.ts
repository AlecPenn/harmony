export const australianVoices=['en-AU-NatashaNeural','en-AU-FreyaNeural','en-AU-AnnetteNeural'] as const;
export interface VoiceConnection {region:string;key:string;voice:typeof australianVoices[number]}
export interface VoiceConnectionStatus {configured:boolean;region:string;voice:string}
export function validateVoiceConnection(value:unknown):VoiceConnection {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid speech connection');
  const v=value as VoiceConnection;
  if(Object.keys(v).sort().join(',')!=='key,region,voice'||typeof v.region!=='string'||!/^[a-z][a-z0-9]{1,39}$/.test(v.region)||typeof v.key!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(v.key)||!australianVoices.includes(v.voice))throw new Error('Invalid speech connection');
  return {region:v.region,key:v.key,voice:v.voice};
}
