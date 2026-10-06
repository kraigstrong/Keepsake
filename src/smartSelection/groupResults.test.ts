import type { SelectionRoundResultCandidate, SelectionRoundResults } from './api';
import { resultSections, resultsHeadline, resultsIntro } from './groupResults';

const alex = { userId: 'alex', displayName: 'Alex' };
const blair = { userId: 'blair', displayName: 'Blair' };
const casey = { userId: 'casey', displayName: 'Casey' };

function candidate(
  recipeId: string,
  overrides: Partial<SelectionRoundResultCandidate>,
): SelectionRoundResultCandidate {
  return {
    recipeId,
    yesCount: 0,
    completedParticipantCount: 3,
    category: 'mixed',
    chosenBy: [],
    passedBy: [],
    ...overrides,
  };
}

function results(
  candidates: SelectionRoundResultCandidate[],
  completed = 3,
): SelectionRoundResults {
  return {
    roundId: 'round-1',
    status: 'ready_for_review',
    completedParticipantCount: completed,
    candidates,
  };
}

const titles = new Map([
  ['tacos', 'Tacos'],
  ['soup', 'Lentil Soup'],
  ['curry', 'Chickpea Curry'],
  ['pasta', 'Pasta'],
  ['salmon', 'Miso Salmon'],
]);

describe('resultSections', () => {
  const r = results([
    candidate('tacos', {
      yesCount: 3,
      category: 'unanimous',
      chosenBy: [alex, blair, casey],
    }),
    candidate('soup', {
      yesCount: 2,
      category: 'majority',
      chosenBy: [alex, blair],
      passedBy: [casey],
    }),
    candidate('curry', { yesCount: 2, category: 'majority', chosenBy: [alex, casey] }),
    candidate('pasta', { yesCount: 1, category: 'mixed', chosenBy: [blair], passedBy: [alex] }),
    candidate('salmon', { yesCount: 0, category: 'mixed', passedBy: [alex, blair, casey] }),
  ]);

  it('sorts picks into everyone / most / mixed, dropping what nobody chose', () => {
    const sections = resultSections(r, titles, 'alex');
    expect(sections.unanimous.map((row) => row.title)).toEqual(['Tacos']);
    expect(sections.majority.map((row) => row.title)).toEqual(['Lentil Soup', 'Chickpea Curry']);
    expect(sections.mixed.map((row) => row.title)).toEqual(['Pasta']);
  });

  it('names who chose a unanimous pick, with you as You', () => {
    expect(resultSections(r, titles, 'alex').unanimous[0]!.detail).toBe('You, Blair and Casey');
  });

  it('names an explicit pass on a majority pick, and only an explicit one', () => {
    const { majority } = resultSections(r, titles, 'alex');
    expect(majority[0]!.detail).toBe('2 of 3 chose this · Casey passed');
    // Blair never reached the curry: no "Blair passed".
    expect(majority[1]!.detail).toBe('2 of 3 chose this');
  });

  it('keeps mixed picks to a count', () => {
    expect(resultSections(r, titles, 'alex').mixed[0]!.detail).toBe('1 of 3 chose this');
  });

  it('ticks only the unanimous picks by default', () => {
    const sections = resultSections(r, titles, 'alex');
    expect(sections.unanimous.every((row) => row.checkedByDefault)).toBe(true);
    expect([...sections.majority, ...sections.mixed].some((row) => row.checkedByDefault)).toBe(
      false,
    );
  });

  it('orders a section by how many chose each pick, deck order breaking ties', () => {
    const fourPeople = results(
      [
        candidate('pasta', { yesCount: 1, category: 'mixed', chosenBy: [alex] }),
        candidate('soup', { yesCount: 2, category: 'mixed', chosenBy: [alex, blair] }),
        candidate('curry', { yesCount: 1, category: 'mixed', chosenBy: [casey] }),
      ],
      4,
    );
    expect(resultSections(fourPeople, titles, 'alex').mixed.map((row) => row.recipeId)).toEqual([
      'soup',
      'pasta',
      'curry',
    ]);
  });
});

describe('resultsIntro', () => {
  it('says when the round closed with people unfinished', () => {
    expect(resultsIntro(2, 3)).toBe('Closed with 2 of 3 in.');
    expect(resultsIntro(3, 3)).toBe('Everyone finished.');
  });
});

describe('resultsHeadline', () => {
  it('is honest about how much agreement there was', () => {
    const none = resultSections(
      results([candidate('pasta', { yesCount: 1, category: 'mixed', chosenBy: [alex] })]),
      titles,
      'alex',
    );
    expect(resultsHeadline(none)).toBe('No strong matches');

    const one = resultSections(
      results([candidate('soup', { yesCount: 2, category: 'majority', chosenBy: [alex, blair] })]),
      titles,
      'alex',
    );
    expect(resultsHeadline(one)).toBe('Only one clear match');

    const two = resultSections(
      results([
        candidate('soup', { yesCount: 2, category: 'majority', chosenBy: [alex, blair] }),
        candidate('tacos', { yesCount: 3, category: 'unanimous', chosenBy: [alex, blair, casey] }),
      ]),
      titles,
      'alex',
    );
    expect(resultsHeadline(two)).toBe('Your matches');
  });
});
