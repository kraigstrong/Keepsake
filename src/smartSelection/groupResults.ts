import type { SelectionResultCategory, SelectionResultPerson, SelectionRoundResults } from './api';
import { joinNames } from './groupRound';

// How a closed group round's consensus reads on the results screen (1j)
// and the too-few state (1l). Human wording, no percentages.

export interface ResultRow {
  recipeId: string;
  title: string;
  category: SelectionResultCategory;
  /** "Alex and Blair", "2 of 3 chose this · Casey passed", "1 of 3 chose this". */
  detail: string;
  checkedByDefault: boolean;
}

export interface ResultSections {
  unanimous: ResultRow[];
  majority: ResultRow[];
  mixed: ResultRow[];
}

function names(people: SelectionResultPerson[], userId: string | null): string[] {
  return people.map((person) =>
    person.userId === userId ? 'You' : (person.displayName ?? 'Someone'),
  );
}

/**
 * Splits picks into the three sections, dropping anything nobody chose.
 * Only unanimous picks start ticked; everything else is opt-in. Someone
 * who never reached a card is never named as passing on it — passedBy
 * holds explicit "no"s only.
 */
export function resultSections(
  results: SelectionRoundResults,
  titles: Map<string, string>,
  userId: string | null,
): ResultSections {
  const sections: ResultSections = { unanimous: [], majority: [], mixed: [] };
  for (const candidate of results.candidates) {
    if (candidate.yesCount === 0) continue;
    const chosenBy = names(candidate.chosenBy, userId);
    const passedBy = names(candidate.passedBy, userId);
    const count = `${candidate.yesCount} of ${candidate.completedParticipantCount} chose this`;
    const detail =
      candidate.category === 'unanimous'
        ? joinNames(chosenBy)
        : candidate.category === 'majority' && passedBy.length > 0
          ? `${count} · ${joinNames(passedBy)} passed`
          : count;
    sections[candidate.category].push({
      recipeId: candidate.recipeId,
      title: titles.get(candidate.recipeId) ?? 'A recipe',
      category: candidate.category,
      detail,
      checkedByDefault: candidate.category === 'unanimous',
    });
  }
  for (const rows of [sections.unanimous, sections.majority, sections.mixed]) {
    rows.sort((a, b) => yesCountOf(results, b) - yesCountOf(results, a));
  }
  return sections;
}

function yesCountOf(results: SelectionRoundResults, row: ResultRow): number {
  return results.candidates.find((c) => c.recipeId === row.recipeId)?.yesCount ?? 0;
}

/** "Closed with 2 of 3 in" when someone hadn't finished, otherwise "Everyone finished." */
export function resultsIntro(completedCount: number, participantCount: number): string {
  if (completedCount < participantCount) {
    return `Closed with ${completedCount} of ${participantCount} in.`;
  }
  return 'Everyone finished.';
}

/** The headline, honest about how much agreement there was (1j vs 1l). */
export function resultsHeadline(sections: ResultSections): string {
  const strong = sections.unanimous.length + sections.majority.length;
  if (strong === 0) return 'No strong matches';
  if (strong === 1) return 'Only one clear match';
  return 'Your matches';
}
