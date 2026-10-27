export const latencyFields=['wake_ms','speaker_id_ms','speech_end_ms','stt_ms','intent_ms','model_router_ms','llm_first_token_ms','tool_start_ms','tool_complete_ms','tts_first_audio_ms','ui_reaction_ms','full_turn_ms'] as const;
export type LatencyField=typeof latencyFields[number];
export type SpanState='pending'|'completed'|'failed'|'cancelled'|'unavailable'|'not_applicable';
export interface LatencyMetric {ms:number|null;state:SpanState;}
export interface LatencySpan {id:number;field:LatencyField;startMs:number;endMs:number|null;state:SpanState;}
export interface LatencyTrace {version:2;id:string;operation:'voice_preview'|'conversation'|'local_check'|'tool'|'reasoning';state:'pending'|'completed'|'failed'|'cancelled';metrics:Record<LatencyField,LatencyMetric>;spans:LatencySpan[];droppedSpans:number;}
