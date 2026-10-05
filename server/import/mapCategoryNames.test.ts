import { mapCategoryNamesToIds } from './mapCategoryNames';

const CATEGORIES = [
  { id: 'cat-chicken', value: 'Chicken' },
  { id: 'cat-soup', value: 'Soup' },
  { id: 'cat-grill', value: 'Grill' },
];

describe('mapCategoryNamesToIds', () => {
  it('maps names to ids by exact value', () => {
    expect(mapCategoryNamesToIds(['Chicken', 'Soup'], CATEGORIES)).toEqual([
      'cat-chicken',
      'cat-soup',
    ]);
  });

  it('matches case-insensitively', () => {
    expect(mapCategoryNamesToIds(['chicken', 'GRILL'], CATEGORIES)).toEqual([
      'cat-chicken',
      'cat-grill',
    ]);
  });

  it('drops a name with no matching category rather than passing it through', () => {
    expect(mapCategoryNamesToIds(['Chicken', 'Dessert'], CATEGORIES)).toEqual(['cat-chicken']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(mapCategoryNamesToIds(['Dessert'], CATEGORIES)).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(mapCategoryNamesToIds([], CATEGORIES)).toEqual([]);
  });
});

it('maps Turkey from the fetched vocabulary without treating it as Chicken', () => {
  const categories = [...CATEGORIES, { id: 'cat-turkey', value: 'Turkey' }];
  expect(mapCategoryNamesToIds(['turkey'], categories)).toEqual(['cat-turkey']);
});
