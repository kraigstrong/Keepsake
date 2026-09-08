# Placing the starter recipe images

The ten starter images live once, at `starters/<key>.jpg` in the private
`recipe-images` bucket (ADR-0029). Every household that seeds points at the same
objects.

Placing them is a **service-role** step, not a migration and not something the
app can do. That is deliberate: no authenticated caller can write under
`starters/`, because every write policy on the bucket requires
`is_household_member(safe_uuid((storage.foldername(name))[1]))` and
`safe_uuid('starters')` is null. The prefix is read-only by construction, which
is exactly why putting objects there has to happen out of band.

## The ten keys

The key is the filename, minus `.jpg`. It comes from
`src/starterRecipes/content.ts`, and a test asserts any key that is set matches
the `^[a-z0-9-]{1,64}$` pattern the database enforces.

**Only one key is set today.** Licensed stock for the rest was tried and
abandoned — ADR-0029 records what sourcing actually turned up — so the other
nine are `imageKey: null` and render a placeholder. They are null rather than
dangling on purpose: a key with no object behind it still costs a failed
signed-URL request per recipe on every sync pass, indefinitely, while null is
skipped outright.

Adding a photo is therefore two steps in either order: upload the object, and
set that recipe's `imageKey`. Nothing needs all ten to exist.

| Recipe                                           | Object                                       |
| ------------------------------------------------ | -------------------------------------------- |
| Sheet-Pan Chicken Thighs with Potatoes and Lemon | `starters/sheet-pan-chicken-thighs.jpg`      |
| Weeknight Bolognese **(uploaded)**               | `starters/weeknight-bolognese.jpg`           |
| Ground Beef Tacos with Quick Cabbage Slaw        | `starters/ground-beef-tacos.jpg`             |
| Garlic Shrimp and Broccoli Stir-Fry              | `starters/garlic-shrimp-stir-fry.jpg`        |
| Slow Cooker Pulled Pork                          | `starters/slow-cooker-pulled-pork.jpg`       |
| Black Bean and Sweet Potato Chili                | `starters/black-bean-sweet-potato-chili.jpg` |
| Skillet Mac and Cheese                           | `starters/skillet-mac-and-cheese.jpg`        |
| Buttermilk Pancakes                              | `starters/buttermilk-pancakes.jpg`           |
| Brown Butter Chocolate Chip Cookies              | `starters/brown-butter-chocolate-chip-cookies.jpg` |
| Grilled Lemon-Herb Chicken                       | `starters/grilled-lemon-herb-chicken.jpg`    |

A missing object is not an error: the recipe renders its placeholder and starts
showing the photo the moment the object lands, because the path is resolved per
view. So these can go up one at a time.

## What the files have to be

- **JPEG.** The bucket's `allowed_mime_types` is `image/jpeg`, `image/png`,
  `image/webp`, and the database builds the path with a `.jpg` suffix, so JPEG
  is the only one that both matches the key and reads correctly.
- **Square**, to match what the app produces for a user's own hero image
  (`pickHeroImage` crops 1:1) and what every surface lays out for.
- **No larger than 1200×1200**, matching `MAX_DIMENSION` in
  `src/recipes/heroImage.ts`. Bigger buys nothing and costs every device's
  image cache, which has a byte budget (ADR-0013).
- **Stripped of EXIF, verified rather than assumed.** The app re-encodes a
  user's photo specifically to drop location and device metadata; a shipped
  asset should not be the exception. "Strip EXIF" means different things
  depending on the tool — several leave an APP1 segment behind, and GPS tags are
  numeric, so grepping the file for "GPS" proves nothing. Check it:

  ```bash
  python3 -c "from PIL import Image; im=Image.open('FILE'); \
    print(dict(im.getexif())); print('gps:', dict(im.getexif().get_ifd(0x8825)))"
  ```

  Both should be empty. Converting Display P3 to sRGB at the same time is worth
  it — the app's own uploads land in sRGB, and a P3 JPEG can render differently
  on surfaces that ignore the profile.

## Licensing

Whatever ships must permit **commercial use without attribution** — Keepsake is
intended to be charged for eventually, and there is nowhere in the UI for a
credit line.

The plan is now that these are **your own photographs**, which sidesteps the
question entirely. Licensed stock was tried and abandoned; ADR-0029 records why,
and the short version is that the free corpus with usable food photography is
CC BY / CC BY-SA, whose attribution and ShareAlike terms have nowhere to live
here. Anything scraped from a recipe site was never an option, however credited.

If you do source one externally, record where it came from in this file when you
place it — photographer, URL, license, date. These licenses are bespoke and can
change, and "where did this come from" is much harder to answer a year later.

Record where each image came from, in this file, when you place it. The point is
that a year from now the answer is written down rather than remembered.

## Placing them

Needs the **Keepsake Dev Tools** 1Password Environment mounted as `devtools.env`
— the same setup `docs/deploying-edge-functions.md` describes, including that it
is a **named pipe (FIFO)** served live by a 1Password process. Never `cat` it,
and never echo the service-role key: it bypasses RLS entirely and is the one
credential that can write this prefix.

Upload through the Supabase dashboard's Storage browser
(`recipe-images` → **New folder** `starters` → upload), which authenticates as
your dashboard session rather than putting a service-role key on a command line
at all. That is the recommended route, and for ten files it is also the fastest.

**There is one Supabase project today**, so this is one upload. If a separate
staging project ever appears — the plan is that it does before this is charged
for — remember that objects do not travel between projects: nothing about
pushing the migration copies them, so each environment needs its own upload.

## Verifying

Sign in to the app on a device against the environment you just uploaded to,
take the starter-recipes offer on a fresh account, and confirm the images appear
in Library, the Help Me Choose deck and This Week.

Checking a signed URL resolves is not sufficient on its own — it proves the
object exists and the read policy matches, but not that the key in
`content.ts` is the one you uploaded. A typo'd key fails soft, as a recipe that
silently never shows a photo.

## Replacing one later

Replacing them with real photography is the plan (`docs/proposals/starter-recipes.md`
§4), and it is **not** a straight overwrite. `src/sync/imageCache.ts` mirrors
images locally keyed by path, with no revalidation, so any device that has
already cached an image keeps the old bytes until eviction. Overwriting reaches
new installs only.

To reach everyone: upload under a **new key**, update `content.ts`, and run one
statement per image against the environment:

```sql
update public.recipes
set hero_image_path = 'starters/<new-key>.jpg'
where hero_image_path = 'starters/<old-key>.jpg';
```

That is a write against the live database that real accounts are using — treat
it with the care ADR-0028's service-role exception describes, and take a backup
first.
