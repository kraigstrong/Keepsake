/**
 * A maintained corpus of real-world recipe ingredient lines, pulled
 * verbatim from live recipe sites rather than hand-crafted, so
 * parseQuantity() changes get checked against how recipes are
 * actually formatted in the wild — not just the specific bugs that
 * already got fixed. Complements parseQuantity.test.ts's hand-picked
 * fixture corpus (which encodes known-expected behavior line by line);
 * this one is a snapshot-tested regression net instead, since manually
 * verifying exact expected output for every real-world line doesn't
 * scale the way the curated fixtures do. See parseQuantity.realWorld.test.ts.
 *
 * First pulled 2026-08-20 (16 recipes, ~165 lines) while verifying the
 * "N and X/Y unit" mixed-number fix (docs/roadmap.md's Not-yet-triaged
 * backlog) generalizes beyond the one line that surfaced it. Extend
 * this corpus — don't replace it — when a future survey pulls more
 * recipes; each entry's `source` is the exact page the lines came from,
 * so a line can always be traced back to real formatting, not a guess.
 */

export interface IngredientCorpusEntry {
  recipe: string;
  source: string;
  lines: string[];
}

export const REAL_WORLD_INGREDIENT_CORPUS: IngredientCorpusEntry[] = [
  {
    recipe: 'Classic Chocolate Chip Cookies (King Arthur Baking)',
    source: 'https://www.kingarthurbaking.com/recipes/classic-chocolate-chip-cookies-recipe',
    lines: [
      '2/3 cup (142g) light brown sugar, packed',
      '2/3 cup (131g) granulated sugar',
      '8 tablespoons (113g) unsalted butter',
      '1/2 cup (92g) vegetable shortening',
      '3/4 teaspoon table salt, (use 1/2 teaspoon salt if you use salted butter)',
      '2 teaspoons King Arthur Pure Vanilla Extract',
      '1/4 teaspoon almond extract, optional',
      '1 teaspoon cider vinegar or white vinegar',
      '1 teaspoon baking soda',
      '1 large egg',
      '2 cups (240g) King Arthur Unbleached All-Purpose Flour',
      '2 cups (340g) semisweet chocolate chips*',
    ],
  },
  {
    recipe: 'Quick and Easy Brownies (King Arthur Baking)',
    source: 'https://www.kingarthurbaking.com/recipes/quick-and-easy-brownies-recipe',
    lines: [
      '1 cup (120g) King Arthur Unbleached All-Purpose Flour',
      '3/4 cup (64g) unsweetened cocoa, Dutch-process or natural',
      '1 3/4 cups (347g) granulated sugar',
      '1/2 teaspoon table salt',
      '1/4 teaspoon baking powder',
      '1 teaspoon espresso powder, optional; for enhanced chocolate flavor',
      '3 large eggs',
      '8 tablespoons (113g) unsalted butter, melted',
      '1/4 cup (50g) vegetable oil',
      '2 teaspoons King Arthur Pure Vanilla Extract',
      '1 cup (170g) semisweet chocolate chips, optional',
    ],
  },
  {
    recipe: 'My All-Time Favorite Chicken Stew (Budget Bytes)',
    source: 'https://www.budgetbytes.com/chicken-stew/',
    lines: [
      '1 yellow onion',
      '3 ribs celery',
      '4 cloves garlic',
      '½ lb. (230 g) carrots',
      '1¾ lbs. (800 g) chicken thighs (boneless, skinless)',
      '4 Tbsp (60 g) all-purpose flour* (divided)',
      '2 Tbsp (30 g) butter',
      '1 Tbsp olive oil',
      '1½ lbs. (680 g) baby potatoes (cubed Yukon also work)',
      '1 tsp dried parsley',
      '½ tsp dried thyme',
      '½ tsp dried rosemary',
      '½ tsp dried sage',
      '¼ tsp black pepper (freshly cracked)',
      '2 cups (500 ml) chicken broth',
      '2 cups (500 ml) vegetable broth',
      '1 Tbsp fresh parsley (chopped, optional)',
    ],
  },
  {
    recipe: 'Spanish Chickpeas and Rice (Budget Bytes)',
    source: 'https://www.budgetbytes.com/spanish-chickpeas-and-rice/',
    lines: [
      '2 Tbsp olive oil',
      '2 cloves garlic',
      '1/2 Tbsp smoked paprika',
      '1 tsp ground cumin',
      '1/2 tsp dried oregano',
      '1/4 tsp cayenne pepper',
      'Freshly cracked black pepper',
      '1 yellow onion',
      '1 cup uncooked long grain white rice',
      '1 15oz. can diced tomatoes',
      '1 15oz. can quartered artichoke hearts',
      '1 15oz. can chickpeas',
      '1.5 cups vegetable broth*',
      '1/2 tsp salt (or to taste)',
      '1/4 bunch fresh parsley',
      '1 fresh lemon',
    ],
  },
  {
    recipe: 'Healthy Banana Bread (Cookie and Kate)',
    source: 'https://cookieandkate.com/healthy-banana-bread-recipe/',
    lines: [
      '⅓ cup (75 grams) melted coconut oil or extra-virgin olive oil or high quality vegetable oil*',
      '½ cup honey (168 grams) or maple syrup (155 grams)',
      '2 eggs',
      '1 cup (225 grams) mashed ripe bananas (about 2 ½ medium or 2 large bananas)',
      '¼ cup (56 grams) milk of choice or water',
      '1 teaspoon baking soda (NOT baking powder; they aren’t the same!)',
      '1 teaspoon vanilla extract',
      '½ teaspoon salt',
      '½ teaspoon ground cinnamon, plus more to swirl on top',
      '1 ¾ cups (220 grams) white whole wheat flour or regular whole wheat flour**',
    ],
  },
  {
    recipe: 'Classic Vegan Chocolate Chip Cookies, 1 Bowl (Minimalist Baker)',
    source: 'https://minimalistbaker.com/classic-vegan-chocolate-chip-cookies-1-bowl/',
    lines: [
      '2 Tbsp flaxseed meal',
      '5 Tbsp water',
      '1/2 cup packed organic brown sugar',
      '1/3 cup organic cane sugar',
      '1/2 cup vegan butter, room temperature (we prefer Earth Balance // 1 stick = 1/2 cup or 112 g)',
      '2-3 tsp vanilla extract',
      '1 heaping cup unbleached all-purpose flour (1 cup + 2 Tbsp as original recipe is written*)',
      '1 tsp sea salt (plus more for topping)',
      '1 tsp baking powder',
      '1 cup vegan semi-sweet chocolate chips',
    ],
  },
  {
    recipe: 'Super Simple Coconut Chicken Tikka Masala (Half Baked Harvest)',
    source: 'https://www.halfbakedharvest.com/chicken-tikka-masala/',
    lines: [
      '1 medium yellow onion, quartered',
      '1 shallot, halved',
      '6 cloves garlic',
      '2 (1-inch) pieces fresh ginger, peeled',
      '3 tablespoons garam masala',
      '2 teaspoons ground turmeric',
      '2 teaspoons kosher salt',
      '1 teaspoon crushed red pepper flakes',
      'Zest of 1 lemon',
      '2 pounds boneless skinless chicken breast, cubed',
      '½ cup full-fat plain Greek yogurt',
      '1 can (14 ounce) full-fat unsweetened coconut milk',
      '1 can (6 ounce) tomato paste',
      '¼ cup cilantro, chopped',
      '3 cups cooked rice, for serving',
    ],
  },
  {
    recipe: 'Best Classic Meatloaf Recipe (Just A Pinch)',
    source: 'https://www.justapinch.com/recipes/best-classic-meatloaf-recipe-2.html',
    lines: [
      '2 lbs. lean ground beef',
      '1 cup Italian breadcrumbs',
      '2 eggs',
      '1/2 cup onion, diced',
      '2 tsp garlic powder',
      '2 tsp chopped parsley',
      '1 tsp salt',
      '1 tsp pepper',
      '1/2 cup bbq sauce',
      '1/3 cup ketchup',
      '2 tbsp brown sugar',
      '1 tsp yellow mustard',
    ],
  },
  {
    recipe: 'Easy Tomato Soup Recipe (Natasha’s Kitchen)',
    source: 'https://natashaskitchen.com/tomato-soup-recipe/',
    lines: [
      '4 Tbsp unsalted butter',
      '2 yellow onions, (3 cups finely chopped)',
      '3 garlic cloves, (1 Tbsp minced)',
      '56 oz crushed tomatoes, (2, 28-oz cans) with their juice, preferably San Marzano',
      '2 cups chicken stock',
      '1/4 cup chopped fresh basil, plus more to serve',
      '1 Tbsp sugar, or added to taste',
      '1/2 tsp black pepper, or to taste',
      '1/2 cup heavy whipping cream, or to taste to combat acidity',
      '1/3 cup parmesan cheese, freshly grated, plus more to serve',
    ],
  },
  {
    recipe: 'The Best Chocolate Chip Cookies (Just A Pinch)',
    source: 'https://justapinch.com/recipes/the-best-chocolate-chip-cookies-2.html',
    lines: [
      '2 cups butter flavored shortening',
      '1 1/2 cups packed brown sugar',
      '1 1/2 cups white sugar',
      '4 eggs',
      '4 teaspoons vanilla extract',
      '4 1/2 cups all-purpose flour',
      '2 teaspoons baking soda',
      '1 teaspoon salt',
      '2 cups semisweet chocolate chips',
      '1 cup flaked coconut',
      '1 cup chopped macadamia nuts',
    ],
  },
  {
    recipe: 'Homemade Cosmic Brownies (King Arthur Baking)',
    source: 'https://www.kingarthurbaking.com/recipes/homemade-cosmic-brownies-recipe',
    lines: [
      '1 3/4 cups (347g) granulated sugar',
      '1 cup (120g) King Arthur Unbleached All-Purpose Flour',
      '3/4 cup (63g) unsweetened cocoa, Dutch-process or natural',
      '1 teaspoon espresso powder, optional',
      '1/2 teaspoon table salt',
      '1/4 teaspoon baking powder',
      '3 large eggs',
      '8 tablespoons (113g) unsalted butter, melted',
      '1/4 cup (50g) vegetable oil',
      '2 teaspoons King Arthur Pure Vanilla Extract',
      '1 1/3 cups (227g) semisweet chocolate chips',
      '1/3 cup (76g) heavy cream',
      '2 tablespoons (28g) unsalted butter',
      '2 tablespoons (27g) sprinkles',
    ],
  },
  {
    recipe: 'Pollo Guisado (Budget Bytes)',
    source: 'https://www.budgetbytes.com/pollo-guisado/',
    lines: [
      '1.5 lb chicken thighs, boneless and skinless*',
      '2 tsp adobo, all-purpose seasoning',
      '2 Tbsp cooking oil',
      '1 yellow onion, large dice',
      '3 cloves garlic, finely chopped',
      '1/2 cup sofrito',
      '8 oz tomato sauce',
      '1 packet sazón seasoning with annatto***',
      '2 bay leaves',
      '2 tsp dried oregano',
      '1/4 cup manzanilla olives, pimiento-stuffed',
      '1 large potato, 2-inch dice (about 1 cup)',
      '2 large carrots, 1/4-inch rounds (about 1 cup )',
      '3 cups chicken stock',
    ],
  },
  {
    recipe: 'Soft Chocolate Chip Cookies (King Arthur Baking)',
    source: 'https://www.kingarthurbaking.com/recipes/soft-chocolate-chip-cookies-recipe',
    lines: [
      '6 tablespoons (85g) unsalted butter',
      '1 cup (213g) light brown sugar or dark brown sugar, packed',
      '2 teaspoons King Arthur Pure Vanilla Extract',
      '3/4 teaspoon table salt',
      '1/2 teaspoon baking soda',
      '1/2 teaspoon baking powder',
      '1 large egg',
      '2 cups (227g) King Arthur Golden Wheat Flour',
      '2 cups (340g) semisweet chocolate chips or one (180g) chocolate bar, chopped',
    ],
  },
  {
    // Edge case: "N N/D-unit" (a whole count of containers each with a
    // mixed-fraction size, e.g. "2 15 1/2-oz. cans") is a distinct shape
    // from the "N and N/D unit" phrasing this survey was pulled to
    // check — parseQuantity() correctly leaves it unit: null (count is
    // the primary quantity, the container size isn't a recognized unit
    // position), matching the existing "2 (15 oz) cans black beans"
    // fixture case's design. Kept here as a real example of that shape.
    recipe: 'Black Bean Chili (Just A Pinch)',
    source: 'https://www.justapinch.com/recipes/black-bean-chili-2.html',
    lines: [
      '1 1/2 pounds boneless pork, cut into 1/2-inch cubes',
      '2 15 1/2-oz. cans black beans, drained',
      '1 cup chopped onion',
      '1 cup chopped yellow bell pepper',
      '1 cup thick and chunky salsa',
      '1 15 1/2-oz. can diced tomatoes, do not drain',
      '2 cloves garlic, minced',
      '1 teaspoon chili powder',
      '1/2 teaspoon cumin',
      '1/4 teaspoon crushed red pepper',
      'sour cream, shredded Cheddar cheese (optional)',
    ],
  },
  {
    recipe: 'Gluten-Free Oatmeal Chocolate Chip Cookies (Minimalist Baker)',
    source: 'https://minimalistbaker.com/gluten-free-oatmeal-chocolate-chip-cookies/',
    lines: [
      '3/4 cup almond flour or almond meal*',
      '3/4 cup rolled oats',
      '1/4 cup finely shredded (desiccated) unsweetened coconut',
      '1/4 cup vegan dark chocolate (chips or chopped bar)',
      '3/4 tsp baking powder',
      '1/4 tsp sea salt',
      '1/3 cup packed organic brown sugar or muscovado sugar',
      '1/4 cup aquafaba',
      '2 Tbsp almond butter*',
      '3 Tbsp avocado oil or melted coconut oil*',
      '1/2 tsp vanilla extract',
    ],
  },
  {
    // The line that originally motivated this survey (docs/roadmap.md's
    // Not-yet-triaged backlog, found live 2026-08-19) — the "N and X/Y
    // unit" phrasing none of the other 15 recipes in this pull happened
    // to use naturally. Site (sallysbakingaddiction.com) blocks
    // automated fetches, so unlike the other entries this one isn't
    // independently re-confirmable here; the exact page/recipe title
    // wasn't recorded at the time, only the domain and this exact line.
    recipe: 'Recipe on sallysbakingaddiction.com (exact page not recorded)',
    source:
      'sallysbakingaddiction.com, confirmed live 2026-08-19 — see docs/roadmap.md Not-yet-triaged backlog',
    lines: ['1 and 3/4 cups (219g) all-purpose flour'],
  },
  {
    // Same survey and site as the entry above, same caveat: the exact
    // page/recipe title wasn't recorded at the time, only the domain
    // and these two lines. Motivated the compound-parenthetical fix —
    // a ranged annotation and a dual-unit slash annotation, respectively.
    recipe:
      'Recipe on sallysbakingaddiction.com (exact page not recorded), compound parentheticals',
    source:
      'sallysbakingaddiction.com, confirmed live 2026-08-19 — see docs/roadmap.md Not-yet-triaged backlog',
    lines: ['3–5 Tablespoons (45–75g/ml) heavy cream', '1/2 cup (113g/120ml) vegetable oil'],
  },
];

export const REAL_WORLD_INGREDIENT_LINES: string[] = REAL_WORLD_INGREDIENT_CORPUS.flatMap(
  (entry) => entry.lines,
);
