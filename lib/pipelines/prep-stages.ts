/**
 * Session preparation stages — shared by the pipeline and the interview screen.
 *
 * This lives in its own module with ZERO imports on purpose. The stage labels
 * are the one thing the client and the server genuinely need to agree on, and
 * importing them from session-prep.ts would drag the whole pipeline into the
 * browser bundle: session-prep → p5-strategy → ai/run → telemetry →
 * supabase/admin, which is the entire AI SDK plus the service-role client.
 *
 * Keeping the constant here means the label and the code that reaches it still
 * cannot drift apart, without either side importing the other's dependencies.
 */

export const SESSION_PREP_STAGES = [
  { key: 'strategy', label: 'Planning the interview' },
  { key: 'blueprint', label: 'Writing your questions' },
  { key: 'challenges', label: 'Preparing the coding round' },
  { key: 'voice', label: 'Warming up the voice' },
] as const;

export type SessionPrepStage = (typeof SESSION_PREP_STAGES)[number]['key'];

/** Shape written to `sessions.progress` and read back over realtime. */
export interface SessionPrepProgress {
  stage: SessionPrepStage;
  index: number;
  total: number;
  detail: string | null;
  at: string;
}
