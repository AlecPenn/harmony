/** Pure policy: a selection is never permission to read credentials or dispatch. */
export type ReasoningTier = 'routine' | 'complex' | 'hardest';
export type ReasoningCapability = 'text' | 'tools' | 'vision' | 'structured';
export interface ModelCandidate {
  id: string;
  tier: ReasoningTier;
  location: 'local' | 'cloud';
  capabilities: readonly ReasoningCapability[];
  ready: boolean;
  healthy: boolean;
  /** Evidence from the coordinator's monotonic clock, not a saved-key status. */
  checkedAtMs: number;
  contextTokens: number;
  maxOutputTokens: number;
  memoryMiB: number;
  /** Conservative request ceiling supplied by a trusted estimator; null means unknown. */
  requestCeilingMicros: number | null;
  firstTokenMs: number | null;
  /** Trusted estimate for this request shape; null means unmeasured. */
  expectedTurnMs: number | null;
}
export interface ModelRouteRequest {
  complexity: ReasoningTier;
  /** Explicit structured user preference; never inferred from retrieved/model text. */
  bigBrain: boolean;
  capabilities: readonly ReasoningCapability[];
  inputTokens: number;
  maxOutputTokens: number;
  toolCount: number;
  risk: 'safe' | 'confirm' | 'high';
  online: boolean;
  localOnly: boolean;
  nowMs: number;
  maxHealthAgeMs: number;
  availableMemoryMiB: number;
  /** Already accounts for other reservations. This function does not reserve funds. */
  remainingBudgetMicros: number;
  /** Explicit limits; null disables that constraint, never treats unknown as zero. */
  maxFirstTokenMs: number | null;
  maxTurnMs: number | null;
}
export interface ModelRoute {
  modelId: string | null;
  requiredTier: ReasoningTier;
  reason: 'selected' | 'no_eligible_model';
  requiresCloudReview: boolean;
  ceilingMicros: number | null;
}
const tiers: readonly ReasoningTier[] = ['routine', 'complex', 'hardest'];
const capabilities: readonly ReasoningCapability[] = ['text', 'tools', 'vision', 'structured'];
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const finite = (n: number) => Number.isFinite(n) && n >= 0;
const validCapabilities = (values: readonly ReasoningCapability[]) => Array.isArray(values)
  && values.length > 0 && values.length <= capabilities.length
  && new Set(values).size === values.length && values.every(value => capabilities.includes(value));

/** No silent tier escalation, provider fallback, retry, prompt inspection or network activity. */
export type RouteBlocker='tier'|'not_ready'|'unhealthy'|'stale_health'|'capability'|'context'|'output_limit'|'memory'|'first_token_unknown'|'first_token_limit'|'duration_unknown'|'duration_limit'|'cost_unknown'|'budget'|'offline'|'local_only';
export interface RouteDecision {route:ModelRoute;candidates:{modelId:string;blockers:RouteBlocker[]}[];}
export function routeModel(request:ModelRouteRequest,candidates:readonly ModelCandidate[]):ModelRoute{return explainRoute(request,candidates).route;}
/** Diagnostic reasons use the same checks that enforce selection, never a parallel policy. */
export function explainRoute(request: ModelRouteRequest, candidates: readonly ModelCandidate[]): RouteDecision {
  if (!request || !tiers.includes(request.complexity) || typeof request.bigBrain !== 'boolean'
    || !validCapabilities(request.capabilities) || !integer(request.inputTokens) || request.inputTokens === 0
    || !integer(request.maxOutputTokens) || request.maxOutputTokens === 0
    || !Number.isSafeInteger(request.inputTokens + request.maxOutputTokens)
    || !integer(request.toolCount) || request.toolCount > 64
    || (request.toolCount > 0 && !request.capabilities.includes('tools'))
    || !['safe', 'confirm', 'high'].includes(request.risk)
    || typeof request.online !== 'boolean' || typeof request.localOnly !== 'boolean'
    || !finite(request.nowMs) || !finite(request.maxHealthAgeMs)
    || request.maxHealthAgeMs <= 0 || request.maxHealthAgeMs > 60000
    || !finite(request.availableMemoryMiB) || !integer(request.remainingBudgetMicros)
    || (request.maxFirstTokenMs !== null && (!finite(request.maxFirstTokenMs) || request.maxFirstTokenMs <= 0))
    || (request.maxTurnMs !== null && (!finite(request.maxTurnMs) || request.maxTurnMs <= 0))) {
    throw new Error('Invalid model routing request');
  }
  if (!Array.isArray(candidates) || candidates.length > 32) throw new Error('Invalid model inventory');
  const ids = new Set<string>();
  // Validate every candidate before filtering; malformed disabled entries cannot evade validation.
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,95}$/.test(candidate.id)
      || ids.has(candidate.id) || !tiers.includes(candidate.tier)
      || !['local', 'cloud'].includes(candidate.location) || !validCapabilities(candidate.capabilities)
      || typeof candidate.ready !== 'boolean' || typeof candidate.healthy !== 'boolean'
      || !finite(candidate.checkedAtMs) || !integer(candidate.contextTokens) || candidate.contextTokens === 0
      || !integer(candidate.maxOutputTokens) || candidate.maxOutputTokens === 0
      || !finite(candidate.memoryMiB)
      || (candidate.requestCeilingMicros !== null && !integer(candidate.requestCeilingMicros))
      || (candidate.firstTokenMs !== null && !finite(candidate.firstTokenMs))
      || (candidate.expectedTurnMs !== null && !finite(candidate.expectedTurnMs))
      || (candidate.firstTokenMs !== null && candidate.expectedTurnMs !== null && candidate.expectedTurnMs < candidate.firstTokenMs)) {
      throw new Error('Invalid model inventory');
    }
    ids.add(candidate.id);
  }
  // Risk affects reasoning capacity, never the independent permission decision.
  const minimum = request.risk === 'high' || request.bigBrain ? 2
    : request.risk === 'confirm' || request.toolCount > 1 ? 1 : 0;
  const requiredTier = tiers[Math.max(tiers.indexOf(request.complexity), minimum)];
  const checks=candidates.map(candidate=>{
    const blockers:RouteBlocker[]=[];
    if(candidate.tier!==requiredTier)blockers.push('tier');
    if(!candidate.ready)blockers.push('not_ready');
    if(!candidate.healthy)blockers.push('unhealthy');
    if(candidate.checkedAtMs>request.nowMs||request.nowMs-candidate.checkedAtMs>request.maxHealthAgeMs)blockers.push('stale_health');
    if(!request.capabilities.every(capability=>candidate.capabilities.includes(capability)))blockers.push('capability');
    if(request.inputTokens+request.maxOutputTokens>candidate.contextTokens)blockers.push('context');
    if(request.maxOutputTokens>candidate.maxOutputTokens)blockers.push('output_limit');
    if(candidate.memoryMiB>request.availableMemoryMiB)blockers.push('memory');
    if(request.maxFirstTokenMs!==null){if(candidate.firstTokenMs===null)blockers.push('first_token_unknown');else if(candidate.firstTokenMs>request.maxFirstTokenMs)blockers.push('first_token_limit');}
    if(request.maxTurnMs!==null){if(candidate.expectedTurnMs===null)blockers.push('duration_unknown');else if(candidate.expectedTurnMs>request.maxTurnMs)blockers.push('duration_limit');}
    if(candidate.requestCeilingMicros===null)blockers.push('cost_unknown');else if(candidate.requestCeilingMicros>request.remainingBudgetMicros)blockers.push('budget');
    if(candidate.location==='cloud'){if(!request.online)blockers.push('offline');if(request.localOnly)blockers.push('local_only');}
    return {candidate,blockers};
  });
  const eligible=checks.filter(check=>check.blockers.length===0).map(check=>check.candidate);
  eligible.sort((a, b) => (a.requestCeilingMicros! - b.requestCeilingMicros!)
    || ((a.firstTokenMs ?? Infinity) - (b.firstTokenMs ?? Infinity))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected = eligible[0];
  const route:ModelRoute=selected
    ? {modelId: selected.id, requiredTier, reason: 'selected', requiresCloudReview: selected.location === 'cloud', ceilingMicros: selected.requestCeilingMicros}
    : {modelId: null, requiredTier, reason: 'no_eligible_model', requiresCloudReview: false, ceilingMicros: null};
  return {route,candidates:checks.map(check=>({modelId:check.candidate.id,blockers:check.blockers}))};
}
