-- #232: extend the shared protein vocabulary. The editor, Library,
-- sync, and import prompts read this table rather than a hard-coded list.
insert into public.categories (group_name, value) values
  ('protein', 'Turkey')
on conflict (group_name, value) do nothing;
