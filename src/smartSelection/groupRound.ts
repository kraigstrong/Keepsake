import type { SelectionRound, SelectionRoundParticipant } from './api';
import { describeDeadline } from './deadlinePresets';

// Pure rules for a group round as one member sees it: where This Week's
// card and "Help me choose" send them, and how each participant's
// progress reads on the waiting screen (1g/1h).

export type GroupRole =
  /** In the round and still swiping. */
  | 'swiping'
  /** In the round and finished — only the round closing moves them on. */
  | 'finished'
  /** A household member who wasn't invited: can watch, can't vote. */
  | 'watching';

export function groupRole(round: SelectionRound, userId: string | null): GroupRole {
  const me = round.participants.find((participant) => participant.userId === userId);
  if (!me) return 'watching';
  return me.completedAt ? 'finished' : 'swiping';
}

/**
 * The screen a member should land on for this round, or null while it
 * is still being created (the start sheet's retry adopts that case).
 */
export function groupRoundPath(round: SelectionRound, userId: string | null): string | null {
  switch (round.status) {
    case 'pending_candidates':
      return null;
    case 'ready_for_review':
    case 'applied':
      return `/smart-selection/${round.id}/results`;
    case 'cancelled':
      return null;
    case 'active':
      return groupRole(round, userId) === 'swiping'
        ? `/smart-selection/${round.id}`
        : `/smart-selection/${round.id}/waiting`;
  }
}

export function participantName(participant: SelectionRoundParticipant, userId: string | null) {
  if (participant.userId === userId) return 'You';
  return participant.displayName ?? 'Someone';
}

/** "Finished · 4 yes", "7 of 12", or "Hasn't started". */
export function progressLabel(participant: SelectionRoundParticipant, deckSize: number): string {
  if (participant.completedAt) return `Finished · ${participant.yesCount} yes`;
  if (participant.decidedCount === 0) return "Hasn't started";
  return `${Math.min(participant.decidedCount, deckSize)} of ${deckSize}`;
}

/** Everyone still swiping, you excluded, in the round's participant order. */
export function unfinishedOthers(round: SelectionRound, userId: string | null): string[] {
  return round.participants
    .filter((participant) => !participant.completedAt && participant.userId !== userId)
    .map((participant) => participant.displayName ?? 'Someone');
}

/** "Blair", "Blair and Casey", "Blair, Casey and Dev". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What closing early costs, said plainly (decision 3 of #172: unfinished ballots don't count). */
export function closeEarlyNote(round: SelectionRound, userId: string | null): string | null {
  const unfinished = unfinishedOthers(round, userId);
  if (unfinished.length === 0) return null;
  const verb = unfinished.length === 1 ? "hasn't" : "haven't";
  return `${joinNames(unfinished)} ${verb} finished. Closing now means their picks won't count.`;
}

/** Share-sheet text for Remind; no push exists yet (#244). */
export function nudgeMessage(round: SelectionRound, now: Date = new Date()): string {
  const deadline = round.closesAt
    ? ` — the round closes ${describeDeadline(new Date(round.closesAt), now)}`
    : '';
  return `Still time to pick this week's meals in Keepsake${deadline}.`;
}

const OPEN_ROUND_NOTE = 'Nothing lands in This Week until it’s reviewed.';

export interface GroupRoundCardCopy {
  title: string;
  detail: string;
  /** 1g's guarantee, while the round is still open. */
  note?: string;
  primary: { label: string; path: string };
  secondary?: { label: string; path: string };
}

/**
 * This Week's card for a group round (1g), or null when there's nothing
 * to show (still being created, or already over).
 */
export function groupRoundCardCopy(
  round: SelectionRound,
  userId: string | null,
  now: Date = new Date(),
): GroupRoundCardCopy | null {
  const deckPath = `/smart-selection/${round.id}`;
  const waitingPath = `${deckPath}/waiting`;
  const resultsPath = `${deckPath}/results`;

  if (round.status === 'ready_for_review') {
    return {
      title: "The round's closed",
      detail: 'See what everyone picked. Nothing lands in This Week until it’s reviewed.',
      primary: { label: 'See matches', path: resultsPath },
    };
  }
  if (round.status !== 'active') return null;

  const deadline = round.closesAt
    ? `Closes ${describeDeadline(new Date(round.closesAt), now)}.`
    : '';
  const others = round.participants
    .filter((participant) => participant.userId !== userId)
    .map((participant) => participant.displayName ?? 'Someone');
  const starter =
    round.createdBy === userId
      ? 'You'
      : (round.participants.find((participant) => participant.userId === round.createdBy)
          ?.displayName ?? 'Someone');
  const me = round.participants.find((participant) => participant.userId === userId);
  const deckSize = round.candidates.length;

  switch (groupRole(round, userId)) {
    case 'swiping': {
      const started = me && me.decidedCount > 0;
      return {
        title: 'Round in progress',
        detail: [
          starter === 'You'
            ? `You started a round with ${joinNames(others)}.`
            : `${starter} started a round.`,
          started ? `You've swiped ${me.decidedCount} of ${deckSize}.` : '',
          deadline,
        ]
          .filter(Boolean)
          .join(' '),
        note: OPEN_ROUND_NOTE,
        primary: { label: started ? 'Keep going' : 'Start swiping', path: deckPath },
        secondary: { label: "See who's in", path: waitingPath },
      };
    }
    case 'finished': {
      const waitingOn = unfinishedOthers(round, userId);
      return {
        title: "You're done",
        detail: [
          waitingOn.length > 0 ? `Waiting on ${joinNames(waitingOn)}.` : 'Everyone has finished.',
          deadline,
        ]
          .filter(Boolean)
          .join(' '),
        note: OPEN_ROUND_NOTE,
        primary: { label: 'See progress', path: waitingPath },
      };
    }
    case 'watching':
      return {
        title: 'Round in progress',
        detail: [`${joinNames(others)} are picking meals.`, deadline].filter(Boolean).join(' '),
        note: OPEN_ROUND_NOTE,
        primary: { label: 'See progress', path: waitingPath },
      };
  }
}
