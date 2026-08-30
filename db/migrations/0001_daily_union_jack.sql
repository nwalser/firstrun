-- Sources stop having a type.
--
-- The `kind` column and its enum are dropped outright rather than left nullable:
-- there is no reading of the product in which a source has a type any more, and
-- a column nobody writes is a column somebody eventually reads.
--
-- Every key is re-minted in the same transaction, because the surface used to be
-- the middle segment of the key itself (`fr_web_9f3a...`) and `SOURCE_KEY_RE` no
-- longer accepts that shape. Leaving the old keys in place would leave rows the
-- edge answers 404 for while the dashboard still displays them as live.
--
-- This ROTATES A PUBLIC CREDENTIAL. Every already-installed client and script tag
-- keeps posting its old key until it ships the new one, and those posts are
-- rejected. That is the cost of the format change, and it is paid here rather
-- than hidden behind a compatibility clause in the regex.
--
-- `gen_random_uuid()` is core Postgres since 13 and is cryptographically random,
-- which `md5(random())` is not. Sixteen hex characters is 64 bits against a
-- unique index; the key only has to be unguessable, not unique across the world.
ALTER TABLE "sources" DROP COLUMN "kind";--> statement-breakpoint
DROP TYPE "public"."source_kind";--> statement-breakpoint
UPDATE "sources"
   SET "ingest_key" = 'fr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
 WHERE "ingest_key" !~ '^fr_[0-9a-f]{16}$';
