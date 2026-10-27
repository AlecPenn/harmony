import {ProtectedSettings} from './protected-settings.ts';
import type {ProfileCipher} from '../packages/identity/vault.ts';
import {validateVoiceConnection,type VoiceConnection,type VoiceConnectionStatus} from '../packages/contracts/voice-connection.ts';
export class VoiceConnectionStore extends ProtectedSettings<VoiceConnection> {
 constructor(path:string,cipher:ProfileCipher){super(path,cipher,validateVoiceConnection);}
 async status():Promise<VoiceConnectionStatus>{const value=await this.read();return {configured:!!value,region:value?.region??'',voice:value?.voice??'en-AU-NatashaNeural'};}
}
