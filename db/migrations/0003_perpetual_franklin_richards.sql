-- A source's tracking plan: what the customer wants tracked declaratively,
-- without editing their own markup. Read with `parseTrackingPlan` from
-- packages/schema/src/tracking-plan.ts.
--
-- Nullable, with no default, and that is the whole design rather than an
-- omission. The serving path chooses between the plain `/t.js` and the composed
-- `/t.js?k=...` on whether there is a plan here with rules in it, so every
-- source that exists today keeps getting the byte-for-byte unchanged tag. A
-- default of '{}' would make all of them look like they had something to say.
--
-- This is CLIENT configuration. Nothing on the ingest path reads it, no entry is
-- validated against it, and an entry a plan produced is an ordinary row. See
-- rules 1 and 2 in CLAUDE.md.

ALTER TABLE "sources" ADD COLUMN "tracking_plan" jsonb;