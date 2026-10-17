-- "Typing…" on both sides of a chat. Each side's browser already asks for
-- anything new every few seconds while the chat is on screen; while somebody is
-- typing, that same request stamps their side's moment here, and the other side
-- reads it back on its own next request. Nothing extra is sent, and nothing is
-- kept: the stamp is only believed for a few seconds, and sending the message
-- clears it.
--
-- agent_typing_name is the name the visitor would see on the reply, so "Sam is
-- typing" matches the message that follows it.
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "visitor_typing_at" TIMESTAMPTZ;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "agent_typing_at" TIMESTAMPTZ;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "agent_typing_name" TEXT;
