-- Visitors on the site, for the admin's "who is here right now" list.
--
-- A row exists only for a visitor who has said yes to the Live chat cookie
-- category on the site's banner. Their browser checks in as they move around
-- (and when their basket changes), which is what lets us see the page they are
-- on, the pages they came through and what is in their basket, and lets us say
-- hello first. Rows are pruned a week after the visitor was last seen, and
-- deleted at once if they withdraw consent.
--
-- The visitor proves the row is theirs the same way a chat is proved: a secret
-- their browser holds, of which only the hash is kept here.

CREATE TABLE IF NOT EXISTS "chat_visitors" (
  "id" TEXT PRIMARY KEY,
  "token_hash" TEXT NOT NULL,
  "ip_hash" TEXT,
  -- Phone, Tablet or Computer. Coarse on purpose: enough to know whether the
  -- page they describe is the phone layout, and nothing that fingerprints.
  "device" TEXT,
  "referrer" TEXT,
  "current_path" TEXT,
  "current_title" TEXT,
  -- The newest few pages, oldest first: [{ "path", "title", "at" }].
  "pages" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "page_views" INTEGER NOT NULL DEFAULT 0,
  -- The basket as last reported, names and prices looked up when it arrived:
  -- [{ "productId", "name", "quantity", "unitPrice" }]. NULL when the site has
  -- no shop or the visitor has never had a basket.
  "cart" JSONB,
  "cart_updated_at" TIMESTAMPTZ,
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chat_visitors_seen_idx"
  ON "chat_visitors" ("last_seen_at" DESC);
CREATE INDEX IF NOT EXISTS "chat_visitors_ip_idx"
  ON "chat_visitors" ("ip_hash", "first_seen_at");

-- Which visitor a chat belongs to, so the chat can show where they are and
-- what they have in their basket. SET NULL rather than CASCADE: pruning a
-- visitor's trail must never take the conversation with it.
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "visitor_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_visitor_id_fkey') THEN
    ALTER TABLE "chat_conversations"
      ADD CONSTRAINT "chat_conversations_visitor_id_fkey"
      FOREIGN KEY ("visitor_id") REFERENCES "chat_visitors"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chat_conversations_visitor_idx"
  ON "chat_conversations" ("visitor_id");

-- visitor | agent. A chat we started is claimed by the visitor's browser with
-- the secret it already holds for its visitor row, so the widget can pick it up
-- without ever having been handed a chat secret of its own.
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "started_by" TEXT NOT NULL DEFAULT 'visitor';

-- The owner's switch for the visitor list. ON by default; it still records
-- nothing until a visitor agrees to the Live chat cookie category.
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "track_visitors" BOOLEAN NOT NULL DEFAULT true;
