import type {AllowanceHistoryEntry} from '../packages/contracts/allowance.ts';
import {reasoningRequestHash,type BoundTextRequest} from '../packages/reasoning/request-binding.ts';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(v);
const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export type ReasoningReservation = BoundTextRequest;
/** Private accounting, not spending authority. One unit is one millionth USD.
 * No calendar reset: a trusted owner flow must explicitly establish a new allowance.
 */
export class ReasoningBudget {
  constructor(private db: DatabaseSync) {}
  #transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=operation(); this.db.exec('COMMIT'); return result;}
    catch(error) {try {this.db.exec('ROLLBACK');} catch {} throw error;}
  }
  create(budgetId: string, limitMicros: number, personId: string): void {
    if (!identifier(budgetId) || !money(limitMicros) || !identifier(personId)) throw new Error('Invalid reasoning budget');
    this.#transaction(() => {
      const old=this.db.prepare('SELECT limit_micros,person_id FROM reasoning_budgets WHERE id=?').get(budgetId);
      if (old) {if (old.limit_micros !== limitMicros || old.person_id !== personId) throw new Error('Budget already established'); return;}
      this.db.prepare('INSERT INTO reasoning_budgets (id,limit_micros,person_id) VALUES (?,?,?)').run(budgetId,limitMicros,personId);
    });
  }
  /** Read-only planning check; dispatch must still reserve atomically. */
  balanceFor(budgetId:string,personId:string){
    if(!identifier(budgetId)||!identifier(personId))throw new Error('Invalid allowance beneficiary');
    const owner=this.db.prepare('SELECT person_id FROM reasoning_budgets WHERE id=?').get(budgetId);
    if(!owner||owner.person_id!==personId)throw new Error('Allowance does not belong to this person');
    return this.balance(budgetId);
  }
  balance(budgetId:string):{limitMicros:number;committedMicros:number;remainingMicros:number}{
    const {limitMicros,committedMicros,remainingMicros}=this.breakdown(budgetId);
    return {limitMicros,committedMicros,remainingMicros};
  }
  /** One consistent aggregate; no prompts, request hashes, keys or other people's budgets. */
  breakdown(budgetId:string){
    if(!identifier(budgetId))throw new Error('Invalid reasoning budget');
    const row=this.db.prepare(`SELECT b.limit_micros,
      COALESCE(SUM(CASE WHEN r.state='RESERVED' THEN r.ceiling_micros ELSE 0 END),0) AS waiting,
      COALESCE(SUM(CASE WHEN r.state IN ('DISPATCHED','UNCERTAIN') THEN r.ceiling_micros ELSE 0 END),0) AS uncertain,
      COALESCE(SUM(CASE WHEN r.state='SETTLED' THEN r.actual_micros ELSE 0 END),0) AS settled,
      COALESCE(SUM(CASE WHEN r.state IN ('DISPATCHED','UNCERTAIN') THEN 1 ELSE 0 END),0) AS unresolved
      FROM reasoning_budgets b LEFT JOIN reasoning_reservations r ON r.budget_id=b.id
      WHERE b.id=? GROUP BY b.id`).get(budgetId);
    if(!row||![row.limit_micros,row.waiting,row.uncertain,row.settled,row.unresolved].every(money))throw new Error('Budget unavailable');
    const limitMicros=Number(row.limit_micros),waitingMicros=Number(row.waiting),uncertainMicros=Number(row.uncertain),settledMicros=Number(row.settled);
    const committedMicros=waitingMicros+uncertainMicros+settledMicros;
    if(!money(committedMicros))throw new Error('Budget unavailable');
    return {limitMicros,committedMicros,remainingMicros:Math.max(0,limitMicros-committedMicros),waitingMicros,uncertainMicros,settledMicros,unresolvedCount:Number(row.unresolved)};
  }
  /** Latest-created entries only; reference is a local ledger ID, not a provider receipt. */
  recent(budgetId:string,limit=20):AllowanceHistoryEntry[]{
    if(!identifier(budgetId)||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('Invalid history request');
    const rows=this.db.prepare(`SELECT id,model_id,state,ceiling_micros,actual_micros FROM reasoning_reservations WHERE budget_id=? ORDER BY rowid DESC LIMIT ?`).all(budgetId,limit);
    return rows.map(row=>{
      if(!identifier(row.id)||typeof row.model_id!=='string'||row.model_id.length>100||!['RESERVED','DISPATCHED','UNCERTAIN','SETTLED','RELEASED'].includes(String(row.state))
        ||!money(row.ceiling_micros)||(row.state==='SETTLED'?!money(row.actual_micros):row.actual_micros!==null))throw new Error('History unavailable');
      return {reference:String(row.id),model:row.model_id,state:row.state as AllowanceHistoryEntry['state'],ceilingMicros:Number(row.ceiling_micros),actualMicros:row.actual_micros===null?null:Number(row.actual_micros)};
    });
  }
  reserve(value: ReasoningReservation): string {
    const requestHash=reasoningRequestHash(value);
    return this.#transaction(() => {
      const owner=this.db.prepare('SELECT person_id FROM reasoning_budgets WHERE id=?').get(value.budgetId);
      if(!owner||owner.person_id!==value.personId)throw new Error('Allowance does not belong to this person');
      const balance=this.balance(value.budgetId);
      if (balance.committedMicros > balance.limitMicros || value.ceilingMicros > balance.remainingMicros) throw new Error('Reasoning budget exhausted');
      const active=this.db.prepare("SELECT COUNT(*) AS n FROM reasoning_reservations WHERE state IN ('RESERVED','DISPATCHED','UNCERTAIN')").get()!.n;
      if (Number(active) >= 128) throw new Error('Too many unresolved reservations');
      const id=randomUUID();
      this.db.prepare("INSERT INTO reasoning_reservations (id,budget_id,model_id,estimate_version,ceiling_micros,actual_micros,state,request_hash) VALUES (?,?,?,?,?,NULL,'RESERVED',?)")
        .run(id,value.budgetId,value.modelId,value.estimateVersion,value.ceilingMicros,requestHash);
      return id;
    });
  }
  #transition(id: string, from: readonly string[], state: string, actual: number | null = null): void {
    if (!identifier(id)) throw new Error('Invalid reservation');
    this.#transaction(() => {
      const row=this.db.prepare('SELECT state FROM reasoning_reservations WHERE id=?').get(id);
      if (!row || !from.includes(String(row.state))) throw new Error('Stale reservation transition');
      this.db.prepare('UPDATE reasoning_reservations SET state=?,actual_micros=? WHERE id=?').run(state,actual,id);
    });
  }
  /** Persist before any network send. This does not replace exact-prompt approval. */
  dispatch(id: string, request: BoundTextRequest): void {
    const requestHash=reasoningRequestHash(request);
    if (!identifier(id) || typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(requestHash)) throw new Error('Invalid reservation binding');
    this.#transaction(() => {
      const row=this.db.prepare('SELECT r.state,r.request_hash,b.person_id FROM reasoning_reservations r JOIN reasoning_budgets b ON r.budget_id=b.id WHERE r.id=?').get(id);
      if (!row || row.state!=='RESERVED' || row.request_hash!==requestHash || row.person_id!==request.personId) throw new Error('Reservation does not match request');
      this.db.prepare("UPDATE reasoning_reservations SET state='DISPATCHED' WHERE id=?").run(id);
    });
  }
  /** Safe only before dispatch. A network error or STOP is not evidence of zero billable usage. */
  release(id: string): void {this.#transition(id,['RESERVED'],'RELEASED');}
  uncertain(id: string): void {this.#transition(id,['DISPATCHED'],'UNCERTAIN');}
  /** Trusted reconciler supplies validated charge; overruns remain recorded and block new work. */
  settle(id: string, actualMicros: number): void {
    if (!money(actualMicros)) throw new Error('Invalid settled charge');
    this.#transition(id,['DISPATCHED','UNCERTAIN'],'SETTLED',actualMicros);
  }
  /** Startup-only, after exclusive ownership: never replay or refund a dispatched request. */
  recover(): void {
    this.#transaction(() => {
      this.db.exec("UPDATE reasoning_reservations SET state='RELEASED' WHERE state='RESERVED'; UPDATE reasoning_reservations SET state='UNCERTAIN' WHERE state='DISPATCHED';");
    });
  }
}
