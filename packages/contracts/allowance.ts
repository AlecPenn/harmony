export interface AllowanceHistoryEntry {
 reference:string;
 model:string;
 state:'RESERVED'|'DISPATCHED'|'UNCERTAIN'|'SETTLED'|'RELEASED';
 ceilingMicros:number;
 actualMicros:number|null;
}
