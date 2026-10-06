import type { SelectionRound, SelectionRoundParticipant } from './api';
import {
  closeEarlyNote,
  groupRoundCardCopy,
  groupRole,
  groupRoundPath,
  joinNames,
  nudgeMessage,
  participantName,
  progressLabel,
  unfinishedOthers,
} from './groupRound';

function participant(
  userId: string,
  overrides: Partial<SelectionRoundParticipant> = {},
): SelectionRoundParticipant {
  return {
    userId,
    completedAt: null,
    displayName: userId.charAt(0).toUpperCase() + userId.slice(1),
    decidedCount: 0,
    yesCount: 0,
    ...overrides,
  };
}

function round(overrides: Partial<SelectionRound> = {}): SelectionRound {
  return {
    id: 'round-1',
    householdId: 'household-1',
    createdBy: 'alex',
    mode: 'group',
    mealsOnly: false,
    status: 'active',
    targetCount: 4,
    closesAt: new Date(2026, 9, 7, 20).toISOString(),
    candidateStrategyVersion: 'heuristic-v1',
    revealedAt: null,
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    closedAt: null,
    appliedAt: null,
    appliedBy: null,
    appliedWeeklyPlanId: null,
    participants: [
      participant('alex', { decidedCount: 12, yesCount: 4, completedAt: '2026-10-06T11:00:00Z' }),
      participant('blair', { decidedCount: 7, yesCount: 2 }),
      participant('casey'),
    ],
    candidates: Array.from({ length: 12 }, (_, position) => ({
      recipeId: `recipe-${position}`,
      score: 1,
      reasonCodes: [],
      position,
    })),
    ...overrides,
  };
}

describe('groupRole', () => {
  it('distinguishes swiping, finished and watching', () => {
    expect(groupRole(round(), 'blair')).toBe('swiping');
    expect(groupRole(round(), 'alex')).toBe('finished');
    expect(groupRole(round(), 'dev')).toBe('watching');
    expect(groupRole(round(), null)).toBe('watching');
  });
});

describe('groupRoundPath', () => {
  it('sends someone still swiping to the deck, everyone else to the waiting screen', () => {
    expect(groupRoundPath(round(), 'blair')).toBe('/smart-selection/round-1');
    expect(groupRoundPath(round(), 'alex')).toBe('/smart-selection/round-1/waiting');
    expect(groupRoundPath(round(), 'dev')).toBe('/smart-selection/round-1/waiting');
  });

  it('sends everyone to results once the round has closed or been applied', () => {
    for (const status of ['ready_for_review', 'applied'] as const) {
      for (const userId of ['alex', 'blair', 'dev']) {
        expect(groupRoundPath(round({ status }), userId)).toBe('/smart-selection/round-1/results');
      }
    }
  });

  it('has nowhere to go for a round still being created or cancelled', () => {
    expect(groupRoundPath(round({ status: 'pending_candidates' }), 'alex')).toBeNull();
    expect(groupRoundPath(round({ status: 'cancelled' }), 'alex')).toBeNull();
  });
});

describe('progress', () => {
  it('labels finished, in-progress and not-started participants', () => {
    const [alex, blair, casey] = round().participants;
    expect(progressLabel(alex!, 12)).toBe('Finished · 4 yes');
    expect(progressLabel(blair!, 12)).toBe('7 of 12');
    expect(progressLabel(casey!, 12)).toBe("Hasn't started");
  });

  it('never shows more decided than the deck holds', () => {
    expect(progressLabel(participant('blair', { decidedCount: 14 }), 12)).toBe('12 of 12');
  });

  it('calls you "You" and a missing profile "Someone"', () => {
    expect(participantName(participant('alex'), 'alex')).toBe('You');
    expect(participantName(participant('blair'), 'alex')).toBe('Blair');
    expect(participantName(participant('x', { displayName: null }), 'alex')).toBe('Someone');
  });
});

describe('closing early', () => {
  it('names everyone else still swiping', () => {
    expect(unfinishedOthers(round(), 'alex')).toEqual(['Blair', 'Casey']);
    expect(closeEarlyNote(round(), 'alex')).toBe(
      "Blair and Casey haven't finished. Closing now means their picks won't count.",
    );
  });

  it('leaves you out, and says nothing once everyone else is done', () => {
    const r = round({
      participants: [participant('alex'), participant('blair', { completedAt: 'x' })],
    });
    expect(unfinishedOthers(r, 'alex')).toEqual([]);
    expect(closeEarlyNote(r, 'alex')).toBeNull();
  });

  it('uses the singular for one person', () => {
    const r = round({ participants: [participant('alex'), participant('blair')] });
    expect(closeEarlyNote(r, 'alex')).toBe(
      "Blair hasn't finished. Closing now means their picks won't count.",
    );
  });
});

describe('joinNames', () => {
  it('joins one, two and three names', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Blair'])).toBe('Blair');
    expect(joinNames(['Blair', 'Casey'])).toBe('Blair and Casey');
    expect(joinNames(['Blair', 'Casey', 'Dev'])).toBe('Blair, Casey and Dev');
  });
});

describe('nudgeMessage', () => {
  it('names the deadline relative to now', () => {
    expect(nudgeMessage(round(), new Date(2026, 9, 6, 9))).toBe(
      "Still time to pick this week's meals in Keepsake — the round closes tomorrow at 8 PM.",
    );
  });

  it('omits the deadline when there is none', () => {
    expect(nudgeMessage(round({ closesAt: null }))).toBe(
      "Still time to pick this week's meals in Keepsake.",
    );
  });
});

describe('groupRoundCardCopy', () => {
  const now = new Date(2026, 9, 6, 9);

  it('invites someone still swiping to start, or to keep going', () => {
    const fresh = groupRoundCardCopy(round(), 'casey', now)!;
    expect(fresh.title).toBe('Round in progress');
    expect(fresh.detail).toBe('Alex started a round. Closes tomorrow at 8 PM.');
    expect(fresh.primary).toEqual({ label: 'Start swiping', path: '/smart-selection/round-1' });
    expect(fresh.secondary).toEqual({
      label: "See who's in",
      path: '/smart-selection/round-1/waiting',
    });

    const midway = groupRoundCardCopy(round(), 'blair', now)!;
    expect(midway.detail).toBe("Alex started a round. You're on 7 of 12. Closes tomorrow at 8 PM.");
    expect(midway.primary.label).toBe('Keep going');
  });

  it('tells the creator who they started it with', () => {
    const r = round({
      participants: [participant('alex'), participant('blair'), participant('casey')],
    });
    expect(groupRoundCardCopy(r, 'alex', now)!.detail).toBe(
      'You started a round with Blair and Casey. Closes tomorrow at 8 PM.',
    );
  });

  it('tells a finished participant who they are waiting on', () => {
    const copy = groupRoundCardCopy(round(), 'alex', now)!;
    expect(copy.title).toBe("You're done");
    expect(copy.detail).toBe('Waiting on Blair and Casey. Closes tomorrow at 8 PM.');
    expect(copy.primary).toEqual({
      label: 'See progress',
      path: '/smart-selection/round-1/waiting',
    });
    expect(copy.secondary).toBeUndefined();
  });

  it('lets a member outside the round watch', () => {
    const copy = groupRoundCardCopy(round(), 'dev', now)!;
    expect(copy.detail).toBe('Alex, Blair and Casey are picking meals. Closes tomorrow at 8 PM.');
    expect(copy.primary.path).toBe('/smart-selection/round-1/waiting');
  });

  it('states the guarantee while the round is open, for every role', () => {
    for (const userId of ['alex', 'blair', 'dev']) {
      expect(groupRoundCardCopy(round(), userId, now)!.note).toBe(
        'Nothing lands in This Week until it’s reviewed.',
      );
    }
  });

  it('points everyone at the matches once the round has closed', () => {
    for (const userId of ['alex', 'blair', 'dev']) {
      const copy = groupRoundCardCopy(round({ status: 'ready_for_review' }), userId, now)!;
      expect(copy.title).toBe("The round's closed");
      expect(copy.primary).toEqual({
        label: 'See matches',
        path: '/smart-selection/round-1/results',
      });
    }
  });

  it('shows nothing for a round still being created or already finished', () => {
    for (const status of ['pending_candidates', 'applied', 'cancelled'] as const) {
      expect(groupRoundCardCopy(round({ status }), 'alex', now)).toBeNull();
    }
  });
});
