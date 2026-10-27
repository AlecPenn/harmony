import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Risk} from '../packages/permissions/policy.ts';
export type ActionState='PREPARED'|'RUNNING'|'VERIFYING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'INTERRUPTED'|'ROLLING_BACK'|'UNDONE'|'UNDO_FAILED';
export interface ActionPlan {personId:string;turnId:string;intent:string;toolId:string;toolVersion:number;risk:Risk;permission:'policy'|'human';requestHash:string;inputsHash:string;}
export interface ActionEvidence {resultHash?:string;rollbackReference?:string;}
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const next:Record<ActionState,readonly ActionState[]>={PREPARED:['RUNNING','CANCELLED'],RUNNING:['VERIFYING','FAILED','CANCELLED'],VERIFYING:['SUCCEEDED','FAILED','CANCELLED'],SUCCEEDED:['ROLLING_BACK'],ROLLING_BACK:['UNDONE','UNDO_FAILED'],FAILED:[],CANCELLED:[],INTERRUPTED:[],UNDONE:[],UNDO_FAILED:[]};
/** Durable metadata only. Recording permission evidence does not grant authorization.
 * Future dispatch must persist RUNNING before invoking the exact approved tool inputs.
 */
export class ActionJournal {
 private db:DatabaseSync;private now:()=>Date;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 #time(){return this.now().toISOString();}
 #transaction<T>(operation:()=>T):T{
  this.db.exec('BEGIN IMMEDIATE');
  try{const result=operation();this.db.exec('COMMIT');return result;}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}
 }
 prepare(value:ActionPlan):string{
  if(!value||Object.keys(value).sort().join(',')!=='inputsHash,intent,permission,personId,requestHash,risk,toolId,toolVersion,turnId'||![value.personId,value.turnId,value.intent,value.toolId].every(id)||!Number.isSafeInteger(value.toolVersion)||value.toolVersion<1||!['SAFE','LOW_RISK_WRITE','CONFIRM','RESTRICTED'].includes(value.risk)||!['policy','human'].includes(value.permission)||!hash(value.requestHash)||!hash(value.inputsHash))throw new Error('Invalid action plan');
  if(value.risk==='RESTRICTED'||value.risk==='CONFIRM'&&value.permission!=='human')throw new Error('Unsupported action permission');
  const actionId=randomUUID(),time=this.#time();
  return this.#transaction(()=>{
   this.db.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,time,time,value.personId,value.turnId,value.intent,value.toolId,value.toolVersion,value.risk,value.permission,value.requestHash,value.inputsHash,'PREPARED',0,null,null,null);
   this.db.prepare('INSERT INTO action_events VALUES (?,?,?,?)').run(actionId,0,time,'PREPARED');return actionId;
  });
 }
 transition(actionId:string,revision:number,state:ActionState,evidence:ActionEvidence={}){
  if(!id(actionId)||!Number.isSafeInteger(revision)||revision<0||!Object.hasOwn(next,state)||!evidence||Object.keys(evidence).some(k=>!['resultHash','rollbackReference'].includes(k))||evidence.resultHash!==undefined&&!hash(evidence.resultHash)||evidence.rollbackReference!==undefined&&!id(evidence.rollbackReference))throw new Error('Invalid action transition');
  if(evidence.resultHash!==undefined&&!['SUCCEEDED','FAILED','UNDONE','UNDO_FAILED'].includes(state))throw new Error('Result evidence requires a terminal outcome');
  if((state==='SUCCEEDED'||state==='UNDONE')&&!evidence.resultHash)throw new Error('Verified result hash required');
  if(evidence.rollbackReference!==undefined&&state!=='SUCCEEDED')throw new Error('Rollback reference requires verified success');
  return this.#transaction(()=>{
   const current=this.db.prepare('SELECT state, revision, rollback_reference FROM actions WHERE id=?').get(actionId);
   if(!current||current.revision!==revision||!Object.hasOwn(next,String(current.state))||!next[current.state as ActionState].includes(state))throw new Error('Stale or invalid action transition');
   if(state==='ROLLING_BACK'&&!current.rollback_reference)throw new Error('Undo is unavailable');
   const time=this.#time();
   this.db.prepare('UPDATE actions SET state=?, revision=revision+1, updated_at=?, result_hash=COALESCE(?,result_hash), rollback_reference=COALESCE(?,rollback_reference), undo_result_hash=COALESCE(?,undo_result_hash) WHERE id=? AND revision=?').run(state,time,['UNDONE','UNDO_FAILED'].includes(state)?null:evidence.resultHash??null,evidence.rollbackReference??null,['UNDONE','UNDO_FAILED'].includes(state)?evidence.resultHash??null:null,actionId,revision);
   this.db.prepare('INSERT INTO action_events VALUES (?,?,?,?)').run(actionId,revision+1,time,state);return revision+1;
  });
 }
 /** Startup-only recovery. Interrupted writes/undos require inspection; never auto-retry them. */
 recoverInterrupted(){
  return this.#transaction(()=>{
   const rows=this.db.prepare("SELECT id,revision FROM actions WHERE state IN ('PREPARED','RUNNING','VERIFYING','ROLLING_BACK')").all(),time=this.#time();
   for(const row of rows){const revision=Number(row.revision)+1;this.db.prepare("UPDATE actions SET state='INTERRUPTED',revision=?,updated_at=? WHERE id=?").run(revision,time,row.id);this.db.prepare('INSERT INTO action_events VALUES (?,?,?,?)').run(row.id,revision,time,'INTERRUPTED');}
   return rows.length;
  });
 }
 get(actionId:string){if(!id(actionId))throw new Error('Invalid action id');return this.db.prepare('SELECT * FROM actions WHERE id=?').get(actionId)??null;}
 events(actionId:string){if(!id(actionId))throw new Error('Invalid action id');return this.db.prepare('SELECT revision,time,state FROM action_events WHERE action_id=? ORDER BY revision').all(actionId);}
 recent(limit=20){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid journal limit');return this.db.prepare('SELECT * FROM actions ORDER BY updated_at DESC,id DESC LIMIT ?').all(limit);}
}
