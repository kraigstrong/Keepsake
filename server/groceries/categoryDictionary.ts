/**
 * Static, reviewed keyword -> grocery-aisle mapping (ADR-0022 decision
 * 5) — no AI call, no per-household configuration. Matched against an
 * item's canonicalKey (server/groceries/canonicalKey.ts), so "onions"
 * and "onion" already resolve to the same lookup.
 *
 * RULES is an *ordered* list, checked top to bottom, first match wins —
 * deliberately, so a specific multi-word entry (e.g. "chicken broth" ->
 * Pantry) can be placed ahead of a broader single-word one that would
 * otherwise misfire (e.g. "chicken" -> Meat). Extending this list is a
 * normal, reviewed code change, the same "fixed constant, extended
 * deliberately" posture ADR-0018 uses for the unit vocabulary — not a
 * data-driven or inferred taxonomy, for the same false-positive-risk
 * reason.
 */

export type GroceryCategory = 'produce' | 'meat' | 'frozen' | 'dairy' | 'pantry' | 'other';

export const GROCERY_CATEGORY_LABELS: Record<GroceryCategory, string> = {
  produce: 'Produce',
  meat: 'Meat',
  frozen: 'Frozen',
  dairy: 'Dairy',
  pantry: 'Pantry',
  other: 'Other',
};

// Display order for the grouped review screen.
export const GROCERY_CATEGORY_ORDER: readonly GroceryCategory[] = [
  'produce',
  'meat',
  'frozen',
  'dairy',
  'pantry',
  'other',
];

interface CategoryRule {
  keyword: string;
  category: GroceryCategory;
}

const RULES: readonly CategoryRule[] = [
  // Frozen overrides everything else it co-occurs with ("frozen
  // chicken breast" is Frozen, not Meat; "frozen peas" is Frozen, not
  // Produce) — checked first for that reason.
  { keyword: 'frozen', category: 'frozen' },
  { keyword: 'ice cream', category: 'frozen' },

  // Multi-word overrides — checked before the generic single-word
  // rules below so e.g. "chicken broth" lands in Pantry, not Meat.
  { keyword: 'chicken broth', category: 'pantry' },
  { keyword: 'chicken stock', category: 'pantry' },
  { keyword: 'beef broth', category: 'pantry' },
  { keyword: 'beef stock', category: 'pantry' },
  { keyword: 'vegetable broth', category: 'pantry' },
  { keyword: 'vegetable stock', category: 'pantry' },
  { keyword: 'fish sauce', category: 'pantry' },
  { keyword: 'bouillon', category: 'pantry' },
  { keyword: 'bell pepper', category: 'produce' },
  { keyword: 'chili pepper', category: 'produce' },
  { keyword: 'jalapeno', category: 'produce' },
  { keyword: 'jalapeño', category: 'produce' },
  { keyword: 'green onion', category: 'produce' },
  { keyword: 'scallion', category: 'produce' },
  { keyword: 'sweet potato', category: 'produce' },
  { keyword: 'peanut butter', category: 'pantry' },
  { keyword: 'almond butter', category: 'pantry' },
  { keyword: 'tomato sauce', category: 'pantry' },
  { keyword: 'tomato paste', category: 'pantry' },
  { keyword: 'canned tomato', category: 'pantry' },
  { keyword: 'coconut milk', category: 'pantry' },
  { keyword: 'almond milk', category: 'dairy' },
  { keyword: 'oat milk', category: 'dairy' },
  { keyword: 'soy milk', category: 'dairy' },
  { keyword: 'heavy cream', category: 'dairy' },
  { keyword: 'sour cream', category: 'dairy' },
  { keyword: 'cottage cheese', category: 'dairy' },
  { keyword: 'cream cheese', category: 'dairy' },
  { keyword: 'baking soda', category: 'pantry' },
  { keyword: 'baking powder', category: 'pantry' },
  { keyword: 'vanilla extract', category: 'pantry' },
  { keyword: 'soy sauce', category: 'pantry' },
  { keyword: 'hot sauce', category: 'pantry' },
  { keyword: 'worcestershire sauce', category: 'pantry' },
  { keyword: 'olive oil', category: 'pantry' },
  { keyword: 'vegetable oil', category: 'pantry' },
  { keyword: 'canola oil', category: 'pantry' },
  { keyword: 'sesame oil', category: 'pantry' },
  { keyword: 'chocolate chip', category: 'pantry' },
  { keyword: 'ground beef', category: 'meat' },
  { keyword: 'ground turkey', category: 'meat' },
  { keyword: 'ground pork', category: 'meat' },
  { keyword: 'ground chicken', category: 'meat' },

  // Generic Meat (includes poultry and seafood — PRD's six categories
  // have no separate Seafood bucket).
  { keyword: 'chicken', category: 'meat' },
  { keyword: 'beef', category: 'meat' },
  { keyword: 'steak', category: 'meat' },
  { keyword: 'pork', category: 'meat' },
  { keyword: 'bacon', category: 'meat' },
  { keyword: 'sausage', category: 'meat' },
  { keyword: 'ham', category: 'meat' },
  { keyword: 'turkey', category: 'meat' },
  { keyword: 'lamb', category: 'meat' },
  { keyword: 'veal', category: 'meat' },
  { keyword: 'salmon', category: 'meat' },
  { keyword: 'shrimp', category: 'meat' },
  { keyword: 'tuna', category: 'meat' },
  { keyword: 'cod', category: 'meat' },
  { keyword: 'tilapia', category: 'meat' },
  { keyword: 'crab', category: 'meat' },
  { keyword: 'fish', category: 'meat' },

  // Generic Produce.
  { keyword: 'onion', category: 'produce' },
  { keyword: 'garlic', category: 'produce' },
  { keyword: 'tomato', category: 'produce' },
  { keyword: 'potato', category: 'produce' },
  { keyword: 'carrot', category: 'produce' },
  { keyword: 'celery', category: 'produce' },
  { keyword: 'lettuce', category: 'produce' },
  { keyword: 'spinach', category: 'produce' },
  { keyword: 'kale', category: 'produce' },
  { keyword: 'broccoli', category: 'produce' },
  { keyword: 'cauliflower', category: 'produce' },
  { keyword: 'cucumber', category: 'produce' },
  { keyword: 'zucchini', category: 'produce' },
  { keyword: 'squash', category: 'produce' },
  { keyword: 'mushroom', category: 'produce' },
  { keyword: 'avocado', category: 'produce' },
  { keyword: 'lemon', category: 'produce' },
  { keyword: 'lime', category: 'produce' },
  { keyword: 'apple', category: 'produce' },
  { keyword: 'banana', category: 'produce' },
  { keyword: 'berry', category: 'produce' },
  { keyword: 'grape', category: 'produce' },
  { keyword: 'orange', category: 'produce' },
  { keyword: 'strawberry', category: 'produce' },
  { keyword: 'blueberry', category: 'produce' },
  { keyword: 'raspberry', category: 'produce' },
  { keyword: 'blackberry', category: 'produce' },
  { keyword: 'cranberry', category: 'produce' },
  { keyword: 'cilantro', category: 'produce' },
  { keyword: 'parsley', category: 'produce' },
  { keyword: 'basil', category: 'produce' },
  { keyword: 'mint', category: 'produce' },
  { keyword: 'ginger', category: 'produce' },
  { keyword: 'cabbage', category: 'produce' },
  { keyword: 'corn', category: 'produce' },

  // Generic Dairy (eggs are shelved near dairy in most stores).
  { keyword: 'milk', category: 'dairy' },
  { keyword: 'cheese', category: 'dairy' },
  { keyword: 'butter', category: 'dairy' },
  { keyword: 'yogurt', category: 'dairy' },
  { keyword: 'cream', category: 'dairy' },
  { keyword: 'egg', category: 'dairy' },
  { keyword: 'cheddar', category: 'dairy' },
  { keyword: 'mozzarella', category: 'dairy' },
  { keyword: 'parmesan', category: 'dairy' },

  // Generic Pantry.
  { keyword: 'flour', category: 'pantry' },
  { keyword: 'sugar', category: 'pantry' },
  { keyword: 'salt', category: 'pantry' },
  { keyword: 'pepper', category: 'pantry' },
  { keyword: 'oil', category: 'pantry' },
  { keyword: 'vinegar', category: 'pantry' },
  { keyword: 'rice', category: 'pantry' },
  { keyword: 'pasta', category: 'pantry' },
  { keyword: 'noodle', category: 'pantry' },
  { keyword: 'bread', category: 'pantry' },
  { keyword: 'oat', category: 'pantry' },
  { keyword: 'cereal', category: 'pantry' },
  { keyword: 'honey', category: 'pantry' },
  { keyword: 'syrup', category: 'pantry' },
  { keyword: 'ketchup', category: 'pantry' },
  { keyword: 'mustard', category: 'pantry' },
  { keyword: 'mayonnaise', category: 'pantry' },
  { keyword: 'broth', category: 'pantry' },
  { keyword: 'stock', category: 'pantry' },
  { keyword: 'bean', category: 'pantry' },
  { keyword: 'lentil', category: 'pantry' },
  { keyword: 'chickpea', category: 'pantry' },
  { keyword: 'cornstarch', category: 'pantry' },
  { keyword: 'breadcrumb', category: 'pantry' },
  { keyword: 'nut', category: 'pantry' },
  { keyword: 'jam', category: 'pantry' },
  { keyword: 'cocoa', category: 'pantry' },
  { keyword: 'chocolate', category: 'pantry' },
  { keyword: 'coffee', category: 'pantry' },
  { keyword: 'tea', category: 'pantry' },
  { keyword: 'water', category: 'pantry' },
  { keyword: 'cinnamon', category: 'pantry' },
  { keyword: 'paprika', category: 'pantry' },
  { keyword: 'cumin', category: 'pantry' },
  { keyword: 'oregano', category: 'pantry' },
  { keyword: 'thyme', category: 'pantry' },
  { keyword: 'chili powder', category: 'pantry' },
];

const COMPILED_RULES = RULES.map((rule) => ({
  category: rule.category,
  pattern: new RegExp(`\\b${rule.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
}));

export function categorize(canonicalKey: string): GroceryCategory {
  for (const rule of COMPILED_RULES) {
    if (rule.pattern.test(canonicalKey)) {
      return rule.category;
    }
  }
  return 'other';
}
