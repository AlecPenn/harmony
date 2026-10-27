import {ProtectedSettings} from './protected-settings.ts';
import type {ProfileCipher} from '../packages/identity/vault.ts';
import {validateReasoningConnection,type ReasoningConnection,type ReasoningConnectionStatus} from '../packages/contracts/reasoning-connection.ts';
export class ReasoningConnectionStore extends ProtectedSettings<ReasoningConnection> {
 constructor(path:string,cipher:ProfileCipher){super(path,cipher,validateReasoningConnection);}
 async status():Promise<ReasoningConnectionStatus>{return {configured:!!await this.read(),model:'gpt-6-astra',verified:false};}
}
