/**
 * Protection parameters of the server's match check (`verifyBotMatch`, `serverCheckPolicy`).
 * These are not balance values: they limit what one request may cost the Edge Function
 * (hard limit 2 s CPU per request) and how likely a manipulated bot pick is found.
 */

/**
 * Most picks a reported match may have. A real match has fewer than 50 (at most 7 rounds of
 * at most 7 picks); the limit only keeps absurd bodies cheap to reject.
 */
export const MAX_REPORTED_PICKS = 400;

/**
 * Most decisions of the hard bot (and of any future, expensive level) the server recomputes
 * per report. They are expensive (Monte Carlo: about 20 ms in round 1, up to about 0.4 s in
 * late rounds in the VM), so the server checks a random sample: after the replay, in random
 * order, every decision of the match with the same chance. The client cannot know which. In
 * practice VERIFY_BUDGET_MS usually ends the sample earlier; this cap keeps the cost bounded on
 * fast machines too. A cheat that changes k of n bot picks stays undetected with probability
 * C(n - k, c) / C(n, c) for c checked decisions (one changed pick: 1 - c / n).
 */
export const HARD_CHECK_MAX = 6;

/**
 * Time budget in milliseconds for the sampled bot checks: no further decision is recomputed
 * once this much time has passed since the check started (the replay is included; it always
 * runs to the end, and the first sampled check always runs). A check already started takes its
 * full time, so the worst case is replay + budget + one late decision; with the 2 s CPU limit
 * of an Edge Function that leaves room for a cold start and the database work.
 */
export const VERIFY_BUDGET_MS = 250;
