-- chat module: initial schema.
--
-- Everything lives in the site's own database. There is no chat server: a
-- visitor's browser and the admin's both ask for anything newer than the last
-- message they hold, which is the honest shape of "live" on a host that keeps
-- no connection open between requests.

CREATE TABLE IF NOT EXISTS "chat_settings" (
  "id" TEXT PRIMARY KEY DEFAULT 'singleton',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "position" TEXT NOT NULL DEFAULT 'right',
  "bubble_label" TEXT NOT NULL DEFAULT 'Chat with us',
  "greeting" TEXT NOT NULL DEFAULT 'Hello! Ask us anything and we will get back to you as soon as we can.',
  "transcripts" BOOLEAN NOT NULL DEFAULT true,
  "retention_months" INTEGER NOT NULL DEFAULT 12,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO "chat_settings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "chat_conversations" (
  "id" TEXT PRIMARY KEY,
  -- sha256 of the secret the visitor's browser holds. The secret itself is
  -- never stored, so a copy of this table cannot be used to read a chat.
  "visitor_token_hash" TEXT NOT NULL,
  "visitor_name" TEXT,
  "visitor_email" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "page_url" TEXT,
  "ip_hash" TEXT,
  "unread_for_agents" INTEGER NOT NULL DEFAULT 0,
  "unread_for_visitor" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_message_preview" TEXT,
  -- The visitor's browser push subscription, when they said yes to
  -- notifications. Endpoint plus keys, exactly as the browser handed it over.
  "push_subscription" JSONB,
  "transcript_sent_at" TIMESTAMPTZ,
  "closed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chat_conversations_status_idx"
  ON "chat_conversations" ("status", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS "chat_conversations_updated_idx"
  ON "chat_conversations" ("updated_at");
CREATE INDEX IF NOT EXISTS "chat_conversations_email_idx"
  ON "chat_conversations" (lower("visitor_email"));
CREATE INDEX IF NOT EXISTS "chat_conversations_ip_idx"
  ON "chat_conversations" ("ip_hash", "created_at");

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" BIGSERIAL PRIMARY KEY,
  "conversation_id" TEXT NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
  -- visitor | agent | system
  "sender" TEXT NOT NULL,
  "author_user_id" TEXT,
  "author_name" TEXT,
  "body" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chat_messages_conversation_idx"
  ON "chat_messages" ("conversation_id", "id");

CREATE TABLE IF NOT EXISTS "chat_attachments" (
  "id" TEXT PRIMARY KEY,
  "message_id" BIGINT NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "conversation_id" TEXT NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "media_provider" TEXT NOT NULL,
  "media_key" TEXT NOT NULL,
  "media_url" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chat_attachments_message_idx"
  ON "chat_attachments" ("message_id");
CREATE INDEX IF NOT EXISTS "chat_attachments_conversation_idx"
  ON "chat_attachments" ("conversation_id");
