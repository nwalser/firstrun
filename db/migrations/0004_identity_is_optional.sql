-- Identity stops being a column, and stops being required.
--
-- `distinct_id` was a NOT NULL column every client had to invent a value for.
-- It is gone. The three things a client may now assert are `user.id`,
-- `device.id` and `session.id`, all three OPTIONAL, all three ordinary
-- attributes, and an entry carrying none of them is legal. A unique is
-- `coalesce(attributes ->> 'user.id', attributes ->> 'device.id',
-- attributes ->> 'session.id')`, which is NULL for such an entry and therefore
-- counted in no unique at all.
--
-- Nothing is backfilled, on purpose. The old column held ids this software
-- generated for itself: in a browser a storage key, on a server a process. Both
-- were required to exist, so both existed. Copying them into `device.id` would
-- re-assert exactly the thing this change removes, that we know what machine an
-- entry came from, and it would put that claim on the rows where it is least
-- true. Entries written before this migration therefore count as entries and
-- not as uniques, and every unique series has a visible step at this date.
--
-- DROP COLUMN on a partitioned parent is a catalogue update: it recurses to
-- every partition without rewriting a row. Rule 4 is not in play here.

DROP INDEX IF EXISTS "log_entries_distinct_time_idx";--> statement-breakpoint
ALTER TABLE "log_entries" DROP COLUMN IF EXISTS "distinct_id";
