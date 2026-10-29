-- A note into a chat when the visitor writes again after we have gone offline
-- part way through it: we were answering, now nobody is, and saying nothing
-- leaves them waiting on a reply that is not coming tonight. If we hold no
-- email or phone number for them it asks for one.
--
-- On by default: it only ever speaks in a chat a colleague has already
-- answered, and only while the Online switch is off, so a site that never goes
-- offline mid-chat never sees it.
--
-- offline_notice_at marks when a chat last had it, claimed with a conditional
-- UPDATE so two messages sent at once cannot both earn one. It is owed again
-- only after a colleague has replied since - which is what "we went offline
-- since" means.
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "offline_notice_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "offline_notice_message" TEXT NOT NULL DEFAULT 'Sorry - we have had to step away since we last spoke, so we cannot reply straight away.';
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "offline_notice_at" TIMESTAMPTZ;
