-- The name shown on the automatic messages (welcome, basket). Until now it was
-- always "Our team"; the owner can now call it whatever suits the shop.
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "auto_message_author" TEXT NOT NULL DEFAULT 'Our team';

-- Chats begun by an automatic message (welcome, basket). Until the visitor
-- answers, these stay out of the lists other modules read through the
-- conversation provider, so an unanswered hello leaves no trace in the inbox.
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "auto_started" BOOLEAN NOT NULL DEFAULT false;
