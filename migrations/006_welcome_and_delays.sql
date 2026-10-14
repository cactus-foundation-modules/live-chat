-- A welcome message for visitors who arrive and say nothing, and a delay for the
-- basket message. Both off or immediate by default, so nothing changes on any
-- site until it is asked for.
--
-- welcome_message_at marks the visitors who have had the welcome, claimed with a
-- conditional UPDATE like the basket message so two tabs cannot both send it.
-- cart_added_at is when a visitor first added something and is still waiting for
-- the basket message to fall due; it is cleared once the message is sent or
-- there is no longer any point sending it.
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "welcome_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "welcome_message" TEXT NOT NULL DEFAULT 'Hello! Have a look around, and if there is anything we can help with, just ask here.';
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "welcome_delay_seconds" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "cart_message_delay_seconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "chat_visitors" ADD COLUMN IF NOT EXISTS "welcome_message_at" TIMESTAMPTZ;
ALTER TABLE "chat_visitors" ADD COLUMN IF NOT EXISTS "cart_added_at" TIMESTAMPTZ;
