-- The tracking plan and the application name, both gone.
--
-- Neither was ever asked for. `tracking_plan` held rules the browser tag was
-- served with, so a customer could measure a click from the dashboard without
-- editing their own markup; `asset_name` held an installer basename that one
-- documentation page put in a sentence and nothing else read. The feature is
-- deleted rather than deprecated: there is no reader left for either column, in
-- the app, in the edge, or in the tag, and `/t.js` is one file again with no
-- query string and no database read behind it.
--
-- Dropped rather than left in place. A column nothing writes and nothing reads
-- is a thing the next person has to work out the status of, and the answer to
-- "is this still used" should be visible in the schema rather than in a commit
-- message. Nothing on the ingest path ever consulted either one, so no entry
-- and no number moves.
--
-- DROP COLUMN is a catalogue update: it does not rewrite a row and it takes the
-- lock for as long as that takes. `sources` is small in every deployment.

ALTER TABLE "sources" DROP COLUMN IF EXISTS "tracking_plan";--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN IF EXISTS "asset_name";
