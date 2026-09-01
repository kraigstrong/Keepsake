import type { StarterRecipe } from './types';

/**
 * Ten original recipes offered once to a household with an empty
 * library. Full reasoning, including why the content is original
 * rather than sourced, lives in `docs/proposals/starter-recipes.md`.
 *
 * These are ordinary recipes once seeded — editable, archivable,
 * deletable, and indistinguishable from a user's own except for the
 * attribution below. Nothing downstream knows they are special.
 */

/**
 * Set as `source_attribution` on every seeded recipe. `source_url`
 * stays null: a fake URL would collide with the
 * `(household_id, source_url)` partial unique index and show as a
 * real link in the UI.
 *
 * Worth knowing before it looks like a bug: `source_attribution` is an
 * indexed FTS column, so searching "keepsake" returns all ten.
 */
export const STARTER_SOURCE_ATTRIBUTION = 'Keepsake starter recipe';

export const STARTER_RECIPES: StarterRecipe[] = [
  {
    title: 'Sheet-Pan Chicken Thighs with Potatoes and Lemon',
    permanentNotes:
      'Crisp-skinned thighs and browned potatoes off one pan, with lemon slices that soften into the juices.',
    activeTimeMinutes: 15,
    totalTimeMinutes: 55,
    yieldText: 'Serves 4',
    categories: [{ group: 'protein', value: 'Chicken' }],
    tags: ['sheet pan', 'weeknight', 'one pan'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '8 bone-in, skin-on chicken thighs',
          '1 1/2 lb baby potatoes, halved',
          '1 lemon, thinly sliced',
          '4 cloves garlic, smashed',
          '3 tbsp olive oil',
          '1 tsp kosher salt',
          '1/2 tsp black pepper',
          '1 tsp dried oregano',
          '2 tbsp chopped parsley',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Heat the oven to 425°F.',
          'Toss the potatoes and garlic with 2 tbsp of the oil and half the salt and pepper directly on a rimmed sheet pan. Spread them to the edges.',
          'Pat the thighs dry and rub with the remaining oil, salt, pepper and the oregano.',
          'Nestle the thighs skin-side up among the potatoes and tuck the lemon slices between them.',
          'Roast 40 to 45 minutes, until the skin is crisp and the thighs read 175°F at the bone.',
          'Rest 5 minutes. Scatter the parsley and spoon the pan juices over everything.',
        ],
      },
    ],
  },
  {
    title: 'Weeknight Bolognese',
    permanentNotes:
      'A short-simmer meat sauce built on milk and tomato paste — an hour, not an afternoon, and it freezes well.',
    activeTimeMinutes: 20,
    totalTimeMinutes: 75,
    yieldText: 'Serves 6',
    categories: [
      { group: 'protein', value: 'Beef' },
      { group: 'dish_type', value: 'Pasta' },
    ],
    tags: ['pasta', 'comfort food', 'freezer friendly'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '2 tbsp olive oil',
          '1 yellow onion, finely chopped',
          '1 carrot, finely chopped',
          '1 celery stalk, finely chopped',
          '3 cloves garlic, minced',
          '1 1/2 lb ground beef',
          '1/4 cup tomato paste',
          '1 cup whole milk',
          '1 (28 oz) can crushed tomatoes',
          '1 tsp kosher salt',
          '1/2 tsp black pepper',
          '1 lb rigatoni',
          'Grated Parmesan, for serving',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Heat the oil in a Dutch oven over medium. Cook the onion, carrot and celery 8 minutes, until soft and just starting to colour.',
          'Add the garlic and cook 1 minute.',
          'Add the beef, break it up, and brown 8 to 10 minutes.',
          'Stir in the tomato paste and cook 2 minutes, until it darkens.',
          'Pour in the milk and simmer about 5 minutes, until mostly absorbed.',
          'Add the crushed tomatoes, salt and pepper. Simmer partly covered 45 minutes, stirring now and then.',
          'Cook the pasta to al dente and reserve 1 cup of the water.',
          'Toss the pasta with the sauce, loosening with pasta water until it coats. Serve with Parmesan.',
        ],
      },
    ],
  },
  {
    title: 'Ground Beef Tacos with Quick Cabbage Slaw',
    permanentNotes:
      'Skillet beef with a proper spice mix instead of a packet, and a sharp lime slaw that comes together while it simmers.',
    activeTimeMinutes: 25,
    totalTimeMinutes: 25,
    yieldText: 'Serves 4 (8 tacos)',
    categories: [{ group: 'protein', value: 'Beef' }],
    tags: ['tacos', 'weeknight', 'family favorite'],
    // The only recipe here with two named ingredient sections, so the
    // seeded library exercises the sectioned-ingredient model rather
    // than leaving that path untried until someone imports one.
    ingredientSections: [
      {
        title: 'Slaw',
        lines: [
          '3 cups shredded green cabbage',
          '1/4 cup chopped cilantro',
          '2 tbsp lime juice',
          '1 tbsp olive oil',
          '1/4 tsp kosher salt',
        ],
      },
      {
        title: 'Tacos',
        lines: [
          '1 tbsp neutral oil',
          '1 small white onion, chopped',
          '1 lb ground beef',
          '1 tbsp chili powder',
          '1 tsp ground cumin',
          '1/2 tsp garlic powder',
          '1/2 tsp kosher salt',
          '1/3 cup water',
          '8 corn tortillas',
          'Crumbled cotija or sour cream, for serving',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Toss all the slaw ingredients together and set aside — it improves while everything else cooks.',
          'Heat the oil in a skillet over medium and cook the onion 4 minutes.',
          'Add the beef and brown 6 to 8 minutes, breaking it up as it goes.',
          'Stir in the chili powder, cumin, garlic powder and salt and cook 30 seconds, until fragrant.',
          'Add the water and simmer 3 to 4 minutes, until glossy rather than wet.',
          'Warm the tortillas in a dry pan.',
          'Fill, top with slaw and cheese, and squeeze more lime over.',
        ],
      },
    ],
  },
  {
    title: 'Garlic Shrimp and Broccoli Stir-Fry',
    permanentNotes:
      'Twenty minutes start to finish, one pan, and a sauce whisked together before anything hits the heat.',
    activeTimeMinutes: 20,
    totalTimeMinutes: 20,
    yieldText: 'Serves 4',
    categories: [{ group: 'protein', value: 'Seafood' }],
    tags: ['quick', 'one pan', 'weeknight'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '1 lb large shrimp, peeled and deveined',
          '1 lb broccoli florets',
          '2 tbsp neutral oil',
          '4 cloves garlic, minced',
          '1 tbsp grated fresh ginger',
          '3 tbsp soy sauce',
          '1 tbsp honey',
          '1 tsp toasted sesame oil',
          '1 tsp cornstarch',
          '1/4 cup water',
          'Steamed rice, for serving',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Whisk the soy sauce, honey, sesame oil, cornstarch and water together and set the bowl by the stove.',
          'Pat the shrimp very dry.',
          'Heat 1 tbsp of the oil in a large skillet over high. Sear the shrimp 1 minute per side and move them to a plate — they will finish later.',
          'Add the remaining oil and the broccoli and cook 3 minutes without moving it much, to get some colour.',
          'Add 2 tbsp water, cover, and steam 2 minutes.',
          'Add the garlic and ginger and cook 30 seconds.',
          'Return the shrimp, pour in the sauce, and toss about 1 minute until it thickens and coats. Serve over rice.',
        ],
      },
    ],
  },
  {
    title: 'Slow Cooker Pulled Pork',
    permanentNotes:
      'Fifteen minutes of work, eight hours of nothing, and enough for a crowd or a week of leftovers.',
    activeTimeMinutes: 15,
    totalTimeMinutes: 495,
    yieldText: 'Serves 8',
    categories: [
      { group: 'protein', value: 'Pork' },
      { group: 'preparation', value: 'Slow Cooker' },
    ],
    tags: ['slow cooker', 'make ahead', 'crowd'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '4 lb boneless pork shoulder',
          '1 tbsp kosher salt',
          '2 tsp smoked paprika',
          '1 tsp black pepper',
          '1 tsp garlic powder',
          '1 tsp onion powder',
          '1 tsp brown sugar',
          '1 yellow onion, sliced',
          '1 cup chicken broth',
          '2 tbsp apple cider vinegar',
          'Buns and pickles, for serving',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Pat the pork dry and cut it into three large pieces.',
          'Combine the salt, paprika, pepper, garlic powder, onion powder and brown sugar and rub it over every surface.',
          'Scatter the onion in the slow cooker, add the pork, and pour the broth around the meat rather than over it, so the rub stays put.',
          'Cover and cook on Low 8 hours, until it pulls apart with a fork.',
          'Move the pork to a board, shred it, and discard any large pieces of fat.',
          'Skim the fat from the cooking liquid and stir in the vinegar.',
          'Return the pork to the liquid and toss to coat. Serve on buns with pickles.',
        ],
      },
    ],
  },
  {
    title: 'Black Bean and Sweet Potato Chili',
    permanentNotes:
      'One pot, pantry ingredients, and better the next day. Mash some of the sweet potato at the end and it thickens itself.',
    activeTimeMinutes: 15,
    totalTimeMinutes: 45,
    yieldText: 'Serves 6',
    categories: [
      { group: 'protein', value: 'Vegetarian' },
      { group: 'dish_type', value: 'Soup' },
    ],
    tags: ['one pot', 'vegetarian', 'freezer friendly'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '2 tbsp olive oil',
          '1 yellow onion, chopped',
          '1 red bell pepper, chopped',
          '2 medium sweet potatoes, peeled and cut into 1/2-inch cubes',
          '3 cloves garlic, minced',
          '2 tbsp chili powder',
          '2 tsp ground cumin',
          '1/2 tsp smoked paprika',
          '1 (28 oz) can diced tomatoes',
          '2 (15 oz) cans black beans, drained and rinsed',
          '2 cups vegetable broth',
          '1 tsp kosher salt',
          'Lime wedges, sour cream and cilantro, for serving',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Heat the oil in a large pot over medium and cook the onion and bell pepper 6 minutes.',
          'Add the sweet potato and garlic and cook 2 minutes.',
          'Stir in the chili powder, cumin and paprika and cook 1 minute.',
          'Add the tomatoes, beans, broth and salt.',
          'Bring to a simmer and cook uncovered 25 to 30 minutes, until the sweet potato is tender.',
          'Mash some of the sweet potato against the side of the pot to thicken the chili.',
          'Taste for salt and serve with lime, sour cream and cilantro.',
        ],
      },
    ],
  },
  {
    title: 'Skillet Mac and Cheese',
    permanentNotes:
      'The pasta cooks in the milk, so the starch does the thickening and there is no roux and no second pot.',
    activeTimeMinutes: 25,
    totalTimeMinutes: 25,
    yieldText: 'Serves 4',
    categories: [
      { group: 'protein', value: 'Vegetarian' },
      { group: 'dish_type', value: 'Pasta' },
    ],
    tags: ['comfort food', 'one pan', 'kid friendly'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '3 cups water',
          '2 cups whole milk',
          '12 oz elbow macaroni',
          '1 tsp kosher salt',
          '1/2 tsp mustard powder',
          '8 oz sharp cheddar, grated',
          '2 oz Parmesan, grated',
          '2 tbsp unsalted butter',
          'Black pepper',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Combine the water, milk, macaroni and salt in a wide skillet or saucepan.',
          'Bring to a boil, then drop to a strong simmer.',
          'Cook uncovered 10 to 12 minutes, stirring often, until the pasta is tender and the liquid has gone thick and starchy.',
          'Off the heat, stir in the mustard powder and butter, then the cheeses a handful at a time until smooth.',
          'Season with pepper and serve straight away — it thickens as it sits, so loosen with a splash of milk if needed.',
        ],
      },
    ],
  },
  {
    title: 'Buttermilk Pancakes',
    permanentNotes:
      'A standard batter that rests ten minutes while the pan heats, which is most of the difference between good and great.',
    activeTimeMinutes: 15,
    totalTimeMinutes: 30,
    yieldText: 'Serves 4 (about 12)',
    categories: [{ group: 'protein', value: 'Vegetarian' }],
    tags: ['breakfast', 'weekend', 'kid friendly'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '2 cups all-purpose flour',
          '2 tbsp granulated sugar',
          '2 tsp baking powder',
          '1/2 tsp baking soda',
          '1/2 tsp kosher salt',
          '2 cups buttermilk',
          '2 large eggs',
          '3 tbsp unsalted butter, melted, plus more for the pan',
          'Butter and maple syrup, for serving',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.',
          'In a second bowl, whisk the buttermilk, eggs and melted butter.',
          'Pour the wet into the dry and stir just until combined. Lumps are fine; overmixing is what makes them tough.',
          'Rest the batter 10 minutes while the pan heats.',
          'Heat a griddle or skillet over medium and brush with butter.',
          'Pour 1/4-cup scoops and cook 2 to 3 minutes, until bubbles come up and the edges set.',
          'Flip and cook 1 to 2 minutes more.',
          'Hold finished pancakes on a rack in a 200°F oven while you cook the rest.',
        ],
      },
    ],
  },
  {
    title: 'Brown Butter Chocolate Chip Cookies',
    permanentNotes:
      'Browning the butter first is seven extra minutes and the only thing that separates these from any other cookie.',
    activeTimeMinutes: 25,
    totalTimeMinutes: 90,
    // Deliberately not a serving count: `parseServings` declines to read
    // this, so the seeded library carries a live example of the
    // null-servingsCount path (1/2x-4x presets, no stepper) instead of
    // that branch first appearing on a real user's recipe.
    yieldText: 'Makes about 24 cookies',
    categories: [
      { group: 'protein', value: 'Vegetarian' },
      { group: 'dish_type', value: 'Dessert' },
    ],
    tags: ['baking', 'dessert', 'make ahead'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '1 cup unsalted butter',
          '1 1/4 cups packed brown sugar',
          '1/2 cup granulated sugar',
          '2 large eggs',
          '2 tsp vanilla extract',
          '2 1/2 cups all-purpose flour',
          '1 tsp baking soda',
          '1 tsp kosher salt',
          '10 oz semisweet chocolate, chopped',
          'Flaky sea salt, for finishing',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Melt the butter in a light-coloured saucepan over medium, swirling, 5 to 7 minutes — until the milk solids are golden and it smells nutty.',
          'Pour it into a large bowl and cool 15 minutes.',
          'Whisk in both sugars, then the eggs and vanilla, until smooth and glossy.',
          'Stir in the flour, baking soda and salt just until no dry streaks remain.',
          'Fold in the chocolate.',
          'Chill the dough at least 30 minutes, or overnight.',
          'Heat the oven to 375°F.',
          'Scoop 2-tbsp balls onto parchment-lined sheets, 2 inches apart.',
          'Bake 10 to 12 minutes, until the edges are set and the centres still look slightly underdone.',
          'Finish with flaky salt and cool on the pan 5 minutes before moving them.',
        ],
      },
    ],
  },
  {
    title: 'Grilled Lemon-Herb Chicken',
    permanentNotes:
      'A marinade you can mix in a minute and leave for eight hours, and it works just as well in a grill pan indoors.',
    activeTimeMinutes: 15,
    totalTimeMinutes: 45,
    yieldText: 'Serves 4',
    categories: [
      { group: 'protein', value: 'Chicken' },
      { group: 'preparation', value: 'Grill' },
    ],
    tags: ['grill', 'make ahead', 'summer'],
    ingredientSections: [
      {
        title: null,
        lines: [
          '2 lb boneless skinless chicken thighs',
          '1/4 cup olive oil',
          '1/4 cup lemon juice',
          '3 cloves garlic, minced',
          '1 tbsp chopped fresh oregano',
          '1 tbsp chopped fresh parsley',
          '1 tsp kosher salt',
          '1/2 tsp black pepper',
          'Lemon wedges, for serving',
        ],
      },
    ],
    instructionSections: [
      {
        title: null,
        lines: [
          'Whisk the oil, lemon juice, garlic, oregano, parsley, salt and pepper together in a bowl or zip-top bag.',
          'Add the chicken and turn to coat.',
          'Marinate 30 minutes at room temperature, or up to 8 hours refrigerated.',
          'Heat a grill or grill pan to medium-high and oil the grates.',
          'Grill the thighs 5 to 6 minutes per side, until they read 165°F at the thickest point.',
          'Rest 5 minutes before slicing. Serve with lemon wedges.',
        ],
      },
    ],
  },
];
