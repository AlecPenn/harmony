/** The agent contract (MASTER-CODEX Part XLI). Every specialist gets a bounded task and returns evidence, never just claims.
 * The manager is always HARMONY: specialists can't start other agents or raise their own permission ceiling. */
export interface AgentTask {
 goal:string;scope:string;
 /** Tool ids the specialist may call; each is checked against the ceiling before use. */
 tools:readonly string[];
 /** Maximum tool calls. */
 budget:number;timeLimitMs:number;
 /** Highest risk class allowed. Missions are read-only: SAFE. */
 permissionCeiling:'SAFE';
 context:string;successCriteria:string;
}
export interface Evidence {n:number;title:string;url:string;site:string;excerpt:string;query:string;}
export interface AgentResult {
 status:'SUCCEEDED'|'PARTIAL'|'FAILED'|'CANCELLED';
 result:string;evidence:Evidence[];
 /** What was actually done (tool ids and inputs), for the record. */
 actions:string[];problems:string[];recommendation:string;
}
