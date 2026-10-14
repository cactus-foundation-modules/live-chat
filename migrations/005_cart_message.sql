-- An optional message sent into a visitor's chat when they add something to
-- their basket. Off by default, so nothing changes on any site until it is asked
-- for.
--
-- cart_message_at marks the visitors who have had it, so one visitor gets it
-- once however many things they add, claimed with a conditional UPDATE so two
-- tabs adding at once cannot both send it.
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "cart_message_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "cart_message" TEXT NOT NULL DEFAULT 'Good choice! If you have any questions about that, or want a hand with sizes, finishes or delivery, just ask here.';
ALTER TABLE "chat_visitors" ADD COLUMN IF NOT EXISTS "cart_message_at" TIMESTAMPTZ;
