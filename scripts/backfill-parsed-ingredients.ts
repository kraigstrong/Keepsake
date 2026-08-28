#!/usr/bin/env node
// Re-derives recipe_ingredients' parsed columns from line_text using the
// current parseQuantity, and emits the UPDATEs needed to correct stored
// rows. Reads JSON rows on stdin, writes SQL on stdout, and writes a
// human-readable diff on stderr.
//
// Why this exists: parsing happens at *write* time (RecipeEditorScreen,
// import-recipe) and the result is persisted; the read and scaling paths
// never reparse. A parser fix therefore reaches new saves and imports
// only, and every already-stored recipe keeps whatever the parser
// produced the day it was saved. PR #112 fixed "1 cup (2 sticks) butter"
// doubling to "2 cups (2 sticks) butter"; stored rows still show the
// stale parenthetical (Codex, PR #112).
//
// Re-parses rather than regex-patching ingredient_text in SQL. Re-parsing
// cannot drift from what the app does — it calls the same function —
// whereas a hand-written SQL regex would be a second implementation of
// the parser to keep in step forever. It also picks up every earlier
// parser fix (PRs #83, #89), not only the sticks one.
//
// Non-destructive by construction: line_text is never written, and every
// parsed column is a pure function of it. Re-running is a no-op, and a
// future parser fix makes it useful again. That is also why there is no
// undo — re-running after a revert restores the old values.
//
// Split into read / generate / apply deliberately. The generated SQL is
// an artifact you can read before anything is written, which matters for
// a one-way write over real recipes. It also sidesteps a hard constraint:
// service_role has no SELECT or UPDATE on recipe_ingredients (the
// migrations grant SELECT to authenticated and withhold writes), so this
// cannot go through PostgREST at all and needs a direct connection.
//
//   PSQL='psql "$DATABASE_URL"'   # or: docker exec -i supabase_db_Keepsake psql -U postgres -d postgres
//
//   $PSQL -At -c "select coalesce(json_agg(r),'[]') from (select id, line_text, quantity_min, quantity_max, unit, ingredient_text from public.recipe_ingredients) r" \
//     | node scripts/backfill-parsed-ingredients.ts > /tmp/backfill.sql
//
//   # read /tmp/backfill.sql, then:
//   $PSQL -f /tmp/backfill.sql

import { parseQuantity } from '../server/units/parseQuantity.ts';

const SAMPLE_LIMIT = 15;

interface Row {
  id: string;
  line_text: string;
  quantity_min: number | string | null;
  quantity_max: number | string | null;
  unit: string | null;
  ingredient_text: string | null;
}

// quantity_min/max are numeric and arrive as strings ("1.5") — compare as
// numbers so 1 and "1" don't read as a difference and generate a
// pointless UPDATE.
function sameQuantity(stored: number | string | null, parsed: number | null): boolean {
  if (stored === null || parsed === null) return stored === null && parsed === null;
  return Number(stored) === parsed;
}

function differs(row: Row, parsed: ReturnType<typeof parseQuantity>): boolean {
  return (
    !sameQuantity(row.quantity_min, parsed.quantityMin) ||
    !sameQuantity(row.quantity_max, parsed.quantityMax) ||
    (row.unit ?? null) !== (parsed.unit ?? null) ||
    (row.ingredient_text ?? null) !== (parsed.ingredientText ?? null)
  );
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = (await readStdin()).trim();
  if (!raw) throw new Error('no input on stdin');
  const rows = JSON.parse(raw) as Row[];

  const changes = rows
    .map((row) => ({ row, parsed: parseQuantity(row.line_text) }))
    .filter(({ row, parsed }) => differs(row, parsed));

  console.error(`scanned ${rows.length} rows, ${changes.length} would change`);

  // The samples are the point of reviewing this: a count alone can't tell
  // you whether the diff is the fix you wanted or the parser eating
  // something it shouldn't. stderr, so they never land in the SQL file.
  for (const { row, parsed } of changes.slice(0, SAMPLE_LIMIT)) {
    console.error(`\n  line: ${row.line_text}`);
    console.error(
      `   was: qty=${row.quantity_min}..${row.quantity_max} unit=${row.unit} text=${JSON.stringify(row.ingredient_text)}`,
    );
    console.error(
      `   now: qty=${parsed.quantityMin}..${parsed.quantityMax} unit=${parsed.unit} text=${JSON.stringify(parsed.ingredientText)}`,
    );
  }
  if (changes.length > SAMPLE_LIMIT) {
    console.error(`\n  ... and ${changes.length - SAMPLE_LIMIT} more`);
  }

  if (changes.length === 0) {
    console.error('\nNothing to do.');
    console.log('-- no changes needed');
    return;
  }

  // One transaction: a partial backfill is a worse state than either
  // end, because nothing records how far it got.
  console.log('begin;');
  for (const { row, parsed } of changes) {
    console.log(
      `update public.recipe_ingredients set ` +
        `quantity_min = ${sqlLiteral(parsed.quantityMin)}, ` +
        `quantity_max = ${sqlLiteral(parsed.quantityMax)}, ` +
        `unit = ${sqlLiteral(parsed.unit)}, ` +
        `ingredient_text = ${sqlLiteral(parsed.ingredientText)} ` +
        `where id = ${sqlLiteral(row.id)};`,
    );
  }
  console.log('commit;');
  console.error(`\nWrote ${changes.length} UPDATE statements to stdout.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
