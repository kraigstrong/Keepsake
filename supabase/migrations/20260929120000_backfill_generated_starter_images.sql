-- Points households that already seeded at the full set of starter images
-- (#192). Same reasoning and guards as 20260908120000, which this extends
-- from one recipe to ten -- read that header before changing either.
--
-- Apply only after the objects are uploaded (docs/deploying-starter-images.md):
-- a path with nothing behind it costs a failed signed-URL request per
-- recipe on every sync pass, and the Bolognese repoint below would swap a
-- working photo for a placeholder.

update public.recipes as r
set hero_image_path = public.starter_image_path(k.image_key),
    updated_at = now()
from (values
  ('Sheet-Pan Chicken Thighs with Potatoes and Lemon', 'sheet-pan-chicken-thighs'),
  ('Weeknight Bolognese', 'weeknight-bolognese-v2'),
  ('Ground Beef Tacos with Quick Cabbage Slaw', 'ground-beef-tacos'),
  ('Garlic Shrimp and Broccoli Stir-Fry', 'garlic-shrimp-stir-fry'),
  ('Slow Cooker Pulled Pork', 'slow-cooker-pulled-pork'),
  ('Black Bean and Sweet Potato Chili', 'black-bean-sweet-potato-chili'),
  ('Skillet Mac and Cheese', 'skillet-mac-and-cheese'),
  ('Buttermilk Pancakes', 'buttermilk-pancakes'),
  ('Brown Butter Chocolate Chip Cookies', 'brown-butter-chocolate-chip-cookies'),
  ('Grilled Lemon-Herb Chicken', 'grilled-lemon-herb-chicken')
) as k(title, image_key)
where r.source_attribution = 'Keepsake starter recipe'
  and r.title = k.title
  and r.hero_image_path is null;

-- The Bolognese image was replaced, under a new key because devices cache
-- by path and would otherwise keep the old bytes. Matched on the path
-- alone: any row still on it is showing the old Bolognese photo, whether
-- seeded, renamed or restored, so moving it to the new one is the intent.
-- The old object stays in Storage (docs/deploying-starter-images.md).
update public.recipes
set hero_image_path = public.starter_image_path('weeknight-bolognese-v2'),
    updated_at = now()
where hero_image_path = 'starters/weeknight-bolognese.jpg';
