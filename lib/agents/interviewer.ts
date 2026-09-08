/**
 * IV · The live interviewer.
 *
 * One call per turn, on Groq. It reads where the conversation is, decides what
 * to do about it, and says it. The only model call inside the turn.
 *
 * ── The philosophy this implements ───────────────────────────────────────────
 * The blueprint is a map: milestones, and what counts as having reached them.
 * It is not a route. This agent drives, and the whole point is that it can take
 * the road the candidate opens up — dig into what they just said, answer a
 * question they ask back, follow them somewhere unplanned — while still
 * arriving at the milestones. Relevance is maintained by knowing what is still
 * outstanding, not by refusing to move.
 *
 * D1's own words: the Blueprint sets the destination, the conversation picks
 * the route, and the Orchestrator enforces the fuel budget. This is the middle
 * one, finally doing the job the design described.
 *
 * ── What it is NOT allowed to decide ─────────────────────────────────────────
 * Structure. The orchestrator owns the section budget, the time ceilings, the
 * two-strike rule and the hard stop, and it overrides this agent's action when
 * one of them has been reached (§4 rules that survive as enforcement — see
 * `rules.ts`). It proposes; the turn disposes.
 *
 * ── Prompt size is fixed ─────────────────────────────────────────────────────
 * §10 names context creep in the live agent as the thing that kills it by turn
 * twenty, and §12 lists it as a tracked risk. Three things keep this constant:
 * the resume and JD arrive as P6's pre-written digest rather than as documents,
 * the transcript is a rolling window of the last few exchanges rather than the
 * whole interview, and only the ACTIVE section's goals are described. Turn
 * twenty-five costs the same as turn three.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import type { MemoryItem } from '../engine/l2-memory-store';
import type { SessionRuntime } from '../engine/types';
import { interviewerTurnSchema, type Blueprint, type InterviewerTurn } from './schemas';

const SYSTEM = `You are conducting a live voice interview. You decide what happens next and you say it out loud. There is no separate component that words your questions — what you write is what the candidate hears, spoken.

## What you are steering by

You are given a section brief and a list of things you still need to establish. That list is the point of the conversation. Everything else — which question, in what order, how deep — is yours.

You are NOT working from a script. Write your own questions. The seed questions you are shown are examples of the right pitch and difficulty, not a queue to work through.

## Follow the candidate, and still arrive

When someone takes the conversation somewhere unplanned, go with them for a turn if there is anything there, then bring it back. A person who mentions something more interesting than what you asked about is giving you better material than your plan had. Relevance means keeping hold of what you still need, not refusing to move.

What you must not do is drift and forget. Every turn, look at what is still outstanding and make sure you are getting closer to it.

## The actions

- ASK — a new question aimed at something still outstanding.
- DEEP_DIVE — their last answer touched the topic but missed the specific thing you need. Probe it, quoting their own words back. This is the most valuable thing you do; a generic "can you tell me more" is not a deep dive.
- CLARIFY — they asked what you meant. Answer plainly, then re-ask in sharper terms. Example: you asked how Spark works, they asked which Spark you meant, you say you mean Spark on GCP Dataproc and re-ask. Never treat a request for clarification as a failed answer.
- ANSWER_QUESTION — they asked you something about the role, the team or the company. Answer it from the context you were given, briefly, then continue. If the context does not contain the answer, say you do not know rather than inventing one. You must never invent a fact about the employer.
- REDIRECT — they have gone somewhere with nothing in it, or are answering a different question. Steer back warmly and without correcting them.
- CLOSE_GOAL — this goal is established, or they have shown they cannot supply it. Move on to another goal in this section.
- NEXT_SECTION — this section is done. Say the handoff line and move on.
- END_INTERVIEW — close the interview.

## How you sound

Speech, not writing. Contractions. Short sentences. One question per turn. Nothing over about thirty words — the candidate hears it once and cannot re-read it. No lists, no "firstly", no parentheticals.

acknowledgement is a short, NEUTRAL receipt of what they just said. Never evaluative — no "great", "perfect", "exactly", "good answer", "not quite". Just "Got it.", "Okay.", "That makes sense.", "Right." Leave it empty when acknowledging would be odd. This is not politeness: telling someone mid-interview how they are doing changes how they perform for the rest of it, which corrupts the assessment.

utterance is what you actually ask. For CLARIFY and ANSWER_QUESTION, it contains your answer AND the question that follows it, as one natural piece of speech.

## Every question carries its own frame

You move between topics, so a question that assumes the last one is still in the air gets answered at the wrong scope — and is then graded as if the candidate misunderstood. Name the subject:
  "In your resume you mention Hyrzo — how did retrieval work there?"    ← clearly about their project
  "Setting your own work aside — what actually is a transformer?"        ← clearly general
  "How did you implement RAG?"                                           ← ambiguous, they may answer either

## The two sections with an editor in them

A section of type "coding" or "skill_challenge" is not a conversation you drive. The candidate is handed a problem and works on it on screen, and the words you say entering that section are the handoff.

- Going in: say what is about to happen and get out of the way. "I'm going to put a problem on your screen — talk me through your thinking as you work." Do not describe the problem; they are about to read it. Do not ask a question they have to answer first.
- While they work: nothing is asked of you. You will not be given a turn.
- Coming out: their submission arrives as their answer, and it is the code they wrote. Ask about THAT — the choice they made, the case they did not handle, what they would do differently with more time. "You reached for a dictionary there — what does that cost you on memory?" is a question. "How did you find that?" is not.

Never ask someone to read their code out loud. You have it in front of you.

## Never ask the same question twice

You are shown every question you have already asked. Do not ask any of them again, and do not ask a reworded version of one — the candidate hears the repeat immediately and it reads as not having listened to their answer.

If the thing you still need was already asked and the answer missed it, that is a DEEP_DIVE into what they actually said, not a re-ask. If you have run out of ways into a goal, CLOSE_GOAL and move to the next one rather than circling.

## What the gap report already knows

You are told, per skill, what the resume established before the interview began. It changes the question, so use it:

- STRONG — they can evidence this. Do not ask whether they have done it; ask how deep it goes. The decision, the thing that broke, what they would change. This is where someone gets to be good at something, and an interview that never lets them is a bad interview and a useless report.
- WEAK — the resume gestures at it. Enough to talk about, not enough to be sure. Probe for the specific.
- UNVERIFIED / MISSING — nothing corroborates it. Ask plainly and directly. "I have not worked with that" is a complete and useful answer; take it, note it, and move on rather than pressing.

FOCUS SKILLS, when listed, are what the candidate asked to be interviewed on. Prefer them whenever two questions would serve the outstanding evidence equally well. They never override the section brief or what is still outstanding.

## The clock decides whether you dig or move on

You are told three things every turn: how long this section has been running, what it was budgeted, and how long is left in the whole interview. Use them, because they are the difference between an interview that feels unhurried and one that runs out of time with half the plan unasked.

- UNDER the section budget — you have room. Do not spend it asking a new shallow question. Spend it on DEEP_DIVE into what they just said, or on a factual skill check that tests whether they actually understand the thing they just described. Depth is what the report is built from; breadth just fills minutes.
- AT or NEAR the section budget — take the single biggest outstanding gap, ask that, then hand off.
- OVER the section budget — hand off now. NEXT_SECTION. Whatever is still outstanding here is lost, and that is better than losing a whole section later.
- Near the END of the interview — do not open a new line of enquiry you cannot finish. Close what is open.

## The difficulty you were given is a ceiling

It bounds every question you write. Asking above it does not produce a harder read on the candidate; it produces a worse one, because a question they cannot engage with tells you nothing except that they were rattled. Stay inside it even when an answer tempts you upward.

## Make it a conversation, not a quiz

The single most common failure is question, answer, unrelated question, answer — a form the candidate can feel, and which makes them give shorter answers every turn.

- Start from what they just said. React to the substance of it before you move: "So the queue was the bottleneck, not the database" is worth more than "Okay."
- Use what they gave you. If they mention a system you have not asked about, that is a better next question than the one you had planned.
- Bridge when you change subject. "That's useful. Let me ask about something different" costs three seconds and stops the next question landing out of nowhere.
- Never stack two questions. One thing at a time, and let them finish.

## Emotion is in the words, not in a tag

The voice that speaks this cannot be given a delivery direction, so whatever warmth reaches the candidate has to be in what you actually write. This is not decoration — a candidate who feels heard gives longer, more specific answers, and the whole report is built on what they say.

- Sound like a person who is listening. "That's a nasty one to debug" before the follow-up. "Right, so you inherited it" as a way in.
- Ease off when they are struggling: shorter question, lower difficulty, an explicit "no problem, let's try a different angle".
- Match the moment — curious when they open something up, steady when they are floundering, brisk when they are on a roll and time is short.
- What none of this may become is EVALUATION. "That's interesting" is warmth. "That's a great answer" is a grade, and telling someone mid-interview how they are doing changes how they perform for the rest of it. Warmth about the SUBJECT, never about their performance.

Set emotional_tone to what you are actually doing: warm when you are opening someone up, encouraging when they are struggling, brisk when time is short, steady otherwise.

## targets_evidence

List the evidence ids your question is aiming at, from the outstanding list you were given. This is how the answer gets graded, so be accurate — a question tagged with evidence it cannot possibly surface produces a grade against the wrong rubric. If you are clarifying, redirecting or answering their question, leave it empty.

## difficulty_delta

-1, 0 or +1. Raise only after a complete, confident answer. Lower only when they are struggling. Most turns are 0.`;

export interface InterviewerInput {
  /** P6's digest. The only thing standing in for the resume and the JD. */
  context: Blueprint['context'];
  section: {
    title: string;
    type: string;
    objective: string;
    question_focus: string[];
    must_verify: string[];
  };
  /** Goals still open in THIS section, with what each still needs. */
  goals: Array<{
    goal_id: string;
    statement: string;
    active: boolean;
    outstanding: Array<{ evidence_id: string; description: string }>;
  }>;
  /**
   * Seed questions not yet used. Pitch examples, and the fallback's material.
   *
   * Carries ids so a seed can be RETIRED once spoken. Without that the same
   * examples are shown on every turn and the fallback returns the same sentence
   * forever — which is precisely how an interview ends up asking one question
   * twenty times.
   */
  seeds: Array<{ bank_id: string; text: string; goal_id: string }>;
  /**
   * Every question already asked this session, oldest first.
   *
   * The single most important line in this prompt. The rolling transcript
   * window below only holds the last few exchanges and only those that were
   * ANSWERED, so without this the interviewer genuinely cannot see that it has
   * asked something before.
   */
  askedQuestions: string[];
  /** Last few exchanges, oldest first. The rolling window. */
  recentTurns: Array<{ question: string; answer: string }>;
  memory: MemoryItem[];
  runtime: SessionRuntime;
  sectionBudget: { asked: number; min: number; max: number };
  /** What comes after this section, so a handoff can name it. */
  nextSection: { title: string; type: string } | null;
  /**
   * Where the interview is against its own plan.
   *
   * P6 estimates every section; the orchestrator measures what actually
   * happened. The gap between the two is the only thing that can tell the
   * interviewer whether it is allowed to dig into an answer or has to move on,
   * and without it a section either sprints through its goals in four minutes
   * or eats the two sections after it.
   */
  timing: {
    sectionElapsedSec: number;
    sectionBudgetSec: number;
    elapsedSec: number;
    remainingSec: number;
    /** Derived once here so the prompt and the rules cannot disagree. */
    pace: 'ahead' | 'on_track' | 'over';
  };
  /** The interview's difficulty ceiling, in the words P5 and P6 were given. */
  difficultyBrief: string;
  lastAnswerSignal: {
    wordCount: number;
    newEvidenceCount: number;
    disclaimed: boolean;
    weak: boolean;
  } | null;
  persona: string;
}

export async function runInterviewer(
  input: InterviewerInput,
  context?: RunContext,
): Promise<{ turn: InterviewerTurn; fromFallback: boolean; latencyMs: number }> {
  const result = await runAgent({
    agent: 'IV',
    schema: interviewerTurnSchema,
    system: SYSTEM,
    prompt: buildPrompt(input),
    context,
    meta: {
      turn: input.runtime.turn,
      section: input.section.type,
      goals_open: input.goals.length,
    },
    // Never throws. A failed call costs adaptivity for one turn, not the
    // interview — the caller falls back to the rule layer's own pick.
    fallback: () => fallbackTurn(input),
  });

  return {
    turn: result.data,
    fromFallback: result.fromFallback,
    latencyMs: result.meta.latencyMs,
  };
}

function buildPrompt(input: InterviewerInput): string {
  const lines: string[] = [];

  const c = input.context;
  lines.push(
    `ROLE: ${c.role_title} at ${c.company_name} (${c.seniority})`,
    `WHAT THE ROLE NEEDS: ${c.jd_summary}`,
    `WHO YOU ARE TALKING TO: ${c.resume_summary}`,
  );

  if (c.company_summary) lines.push(`COMPANY: ${c.company_summary}`);

  if (c.candidate_projects.length) {
    lines.push(
      '',
      'THEIR PROJECTS (name these when anchoring a question to their own work):',
      ...c.candidate_projects.map(
        (p) => `- ${p.name}: ${p.one_line}${p.technologies.length ? ` [${p.technologies.join(', ')}]` : ''}`,
      ),
    );
  }

  if (c.claims_worth_probing.length) {
    lines.push('', 'CLAIMS WORTH TESTING:', ...c.claims_worth_probing.map((x) => `- ${x}`));
  }

  /*
   * The gap verdicts and the candidate's own requests.
   *
   * Both optional: blueprints written before these fields existed are still
   * read back and run, and most sessions name no focus skills at all. Absent,
   * the prompt is exactly what it was.
   */
  if (c.skill_status?.length) {
    lines.push(
      '',
      'WHAT THE RESUME ALREADY ESTABLISHES (skill · gap status):',
      ...c.skill_status.map((x) => `- ${x}`),
    );
  }

  if (c.focus_skills?.length) {
    lines.push('', `THE CANDIDATE ASKED TO BE INTERVIEWED ON: ${c.focus_skills.join(', ')}`);
  }

  lines.push(
    '',
    `SECTION: ${input.section.title} (${input.section.type})`,
    `OBJECTIVE: ${input.section.objective}`,
    `ASK THESE KINDS OF QUESTION: ${input.section.question_focus.join(' · ')}`,
    `MUST ESTABLISH: ${input.section.must_verify.join(' · ')}`,
  );

  lines.push('', 'GOALS STILL OPEN IN THIS SECTION:');
  for (const goal of input.goals) {
    lines.push(`${goal.active ? '▸ ACTIVE' : '·'} ${goal.goal_id}: ${goal.statement}`);
    if (goal.outstanding.length === 0) {
      lines.push('    (everything established — close this goal)');
    } else {
      for (const ev of goal.outstanding) lines.push(`    still needed — ${ev.evidence_id}: ${ev.description}`);
    }
  }

  if (input.askedQuestions.length) {
    lines.push(
      '',
      'QUESTIONS YOU HAVE ALREADY ASKED — do not repeat or reword any of these:',
      ...input.askedQuestions.map((q) => `- ${q}`),
    );
  }

  if (input.seeds.length) {
    lines.push(
      '',
      'EXAMPLES OF THE RIGHT PITCH (do not just read these out):',
      ...input.seeds.map((q) => `- ${q.text}`),
    );
  }

  if (input.recentTurns.length) {
    lines.push('', 'THE CONVERSATION SO FAR (most recent last):');
    for (const t of input.recentTurns) {
      lines.push(`YOU: ${t.question}`, `THEM: ${t.answer}`);
    }
  }

  if (input.memory.length) {
    lines.push(
      '',
      'THINGS THEY MENTIONED EARLIER YOU COULD COME BACK TO:',
      ...input.memory.map((m) => `- ${m.label} (${m.kind})`),
    );
  }

  const a = input.lastAnswerSignal;
  if (a) {
    lines.push(
      '',
      `THEIR LAST ANSWER: ${a.wordCount} words · ${a.newEvidenceCount} new evidence item(s)` +
        `${a.disclaimed ? ' · they said they do not know' : ''}${a.weak ? ' · thin' : ''}`,
    );
  }

  const t = input.timing;
  const mmss = (sec: number) => {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  };

  lines.push(
    '',
    'THE CLOCK:',
    `- this section: ${mmss(t.sectionElapsedSec)} used of ${mmss(t.sectionBudgetSec)} budgeted` +
      `${t.pace === 'ahead' ? ' — you have room, go deeper rather than broader' : t.pace === 'over' ? ' — OVER budget, hand off now' : ' — about right, one more then move on'}`,
    `- whole interview: ${mmss(t.elapsedSec)} elapsed, ${mmss(t.remainingSec)} left`,
    '',
    `DIFFICULTY CEILING: ${input.difficultyBrief}`,
  );

  lines.push(
    '',
    `PACING: question ${input.sectionBudget.asked + 1} of at most ${input.sectionBudget.max} in this section` +
      ` (minimum ${input.sectionBudget.min}). Difficulty ${input.runtime.current_difficulty}/5.` +
      `${input.runtime.consecutive_weak_answers > 0 ? ` ${input.runtime.consecutive_weak_answers} thin answer(s) in a row — ease off.` : ''}`,
    budgetGuidance(input),
  );

  lines.push('', `PERSONA: ${input.persona}`, '', 'Decide what to do and say it.');

  return lines.join('\n');
}

/**
 * Tells the interviewer where it stands in the section.
 *
 * The orchestrator enforces the budget regardless — an over-budget section is
 * moved on whatever this agent says. This exists so it CHOOSES to leave rather
 * than being cut off, which produces a better-aimed last question and a handoff
 * that does not land mid-thought.
 */
function budgetGuidance(input: InterviewerInput): string {
  const { asked, min, max } = input.sectionBudget;
  const next = input.nextSection;
  const where = next ? `Next up is ${next.title} (${next.type}).` : 'This is the last section.';

  /*
   * The clock speaks before the counter does.
   *
   * A section that is over its time has to hand off whatever its question count
   * says, and a section with time in hand should spend it going deeper rather
   * than racing to its question ceiling — which is the difference between an
   * interview that establishes something and one that merely gets through a
   * list.
   */
  if (input.timing.pace === 'over' && asked >= min) {
    return next
      ? `This section is over its time budget. Hand off now with NEXT_SECTION. ${where}`
      : 'This section is over its time budget and it is the last one. Start closing.';
  }
  if (input.timing.pace === 'ahead' && asked < max) {
    return `There is time left in this section. Prefer DEEP_DIVE on what they just said, or a factual skill check, over opening a new topic. ${where}`;
  }

  if (asked >= max) {
    return next
      ? `This section is done. Use NEXT_SECTION and hand off. ${where}`
      : 'This section is done and it is the last one. Use END_INTERVIEW.';
  }
  if (asked >= max - 1) {
    return `One question left here. Spend it on the biggest gap, then move on. ${where}`;
  }
  if (asked < min) return 'Too early to leave this section — there is more to establish.';
  return `You may move on once this section has yielded what it is going to. ${where}`;
}

/**
 * The safe default when the model call fails or times out.
 *
 * Deliberately structural rather than clever: it asks a seed question if one is
 * left, otherwise it moves on. Both are legal, on-topic and boring — which is
 * the right trade for a turn that has already spent its latency budget.
 * Invariant 12: degrade texture, never terminate.
 */
export function fallbackTurn(input: InterviewerInput): InterviewerTurn {
  const active = input.goals.find((g) => g.active) ?? input.goals[0];

  /*
   * The first seed that has NOT been asked.
   *
   * `input.seeds` is already filtered to unused ones, but this checks the text
   * too — a seed only retires when the turn records its bank id, and belt and
   * braces here is cheap. Taking `seeds[0]` unconditionally is what made a
   * failing interviewer repeat one sentence for the whole interview.
   */
  /*
   * The first unused seed BELONGING TO A GOAL THAT IS STILL OPEN.
   *
   * Taking `seeds[0]` regardless is what produced questions labelled with the
   * wrong goal: the active goal closes, its unasked seeds stay at the front of
   * the pool, and the turn then spoke a question about one goal while naming
   * another. That was always wrong — the answer was graded against a rubric
   * written for a question nobody asked — and it is now visible, because that
   * label is the line the candidate reads above the question.
   *
   * Aligned by choosing the question rather than by relabelling it. Falling
   * back to any unused seed keeps the old behaviour when no open goal has one
   * left, which is better than saying nothing.
   */
  const unused = input.seeds.filter((q) => !input.askedQuestions.includes(q.text));
  const openIds = new Set(input.goals.map((g) => g.goal_id));
  const seed = unused.find((q) => openIds.has(q.goal_id)) ?? unused[0];

  const seedGoal = seed ? (input.goals.find((g) => g.goal_id === seed.goal_id) ?? active) : active;

  if (seed && seedGoal) {
    return {
      action: 'ASK',
      target_goal: seedGoal.goal_id,
      targets_evidence: seedGoal.outstanding.slice(0, 3).map((e) => e.evidence_id),
      acknowledgement: 'Okay.',
      utterance: seed.text,
      emotional_tone: input.lastAnswerSignal?.weak ? 'encouraging' : 'neutral',
      difficulty_delta: 0,
      reason: 'Fallback: seed question (interviewer unavailable).',
    };
  }

  /*
   * Out of seeds. Moving on beats repeating: a goal with nothing new to ask is
   * finished whether or not its evidence came in, and §9.6 scores an abandoned
   * goal on what was gathered rather than as a zero.
   */
  if (active && input.goals.length > 1) {
    return {
      action: 'CLOSE_GOAL',
      target_goal: active.goal_id,
      targets_evidence: [],
      acknowledgement: 'Okay.',
      utterance: '',
      emotional_tone: 'neutral',
      difficulty_delta: 0,
      reason: 'Fallback: no unasked material left on this goal.',
    };
  }

  return {
    action: input.nextSection ? 'NEXT_SECTION' : 'END_INTERVIEW',
    target_goal: '',
    targets_evidence: [],
    acknowledgement: 'Okay.',
    utterance: input.nextSection
      ? "Let's move on."
      : "That's everything I wanted to cover — thanks for your time.",
    emotional_tone: 'neutral',
    difficulty_delta: 0,
    reason: 'Fallback: no material left (interviewer unavailable).',
  };
}
