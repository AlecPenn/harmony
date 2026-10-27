/** Private core-only contracts. Embeddings never belong in renderer snapshots or logs. */
export type HouseholdRole = 'OWNER' | 'TEEN' | 'CHILD' | 'GUEST';
export interface SpeakerProfile {
  id: string;
  displayName: string;
  role: HouseholdRole;
  modelId: string;
  stableEmbeddings: readonly (readonly number[])[];
  trustedRecentEmbeddings: readonly (readonly number[])[];
  permissions: readonly string[];
  memoryNamespace: string;
  settings: Readonly<Record<string, boolean>>;
  enrolledAt: number;
  lastCalibration: number;
}
export interface SpeakerCalibration {
  modelId: string;
  dimensions: number;
  rejectBelow: number;
  acceptAt: number;
  minimumMargin: number;
  calibratedAt: number;
  expiresAt: number;
}
export type SpeakerDecision =
  | { state: 'MATCH'; profileId: string; score: number }
  | { state: 'UNCERTAIN' | 'REJECTED'; profileId: null; reason: 'unavailable' | 'quality' | 'spoof' | 'low_match' | 'ambiguous' };
export interface SpeakerEvidence {
  embedding: readonly number[];
  modelId: string;
  quality: 'sufficient' | 'insufficient';
  antiSpoof: 'passed' | 'failed' | 'unavailable';
}
