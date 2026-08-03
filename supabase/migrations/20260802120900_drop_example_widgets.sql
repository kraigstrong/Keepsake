-- Phase 0's example_widgets was scaffolding to prove the migration + RLS
-- + pgTAP pattern before any real domain schema existed (see its own
-- migration comment). households/household_membership/profiles are now
-- the canonical example — drop the placeholder.
drop table if exists public.example_widgets;
