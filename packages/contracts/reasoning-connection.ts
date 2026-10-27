export interface ReasoningConnection {key:string;}
export interface ReasoningConnectionStatus {configured:boolean;model:'gpt-6-astra';verified:false;}
export function validateReasoningConnection(value:unknown):ReasoningConnection {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid reasoning connection');
 const v=value as ReasoningConnection;
 if(Object.keys(v).join(',')!=='key'||typeof v.key!=='string'||!/^[a-zA-Z0-9_-]{16,512}$/.test(v.key))throw new Error('Invalid reasoning connection');
 return {key:v.key};
}
