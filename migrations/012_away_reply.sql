-- The automatic reply while we are offline now covers every chat, not only one
-- a colleague has already answered.
--
-- away_reply_message is what a visitor gets when they write to us while we are
-- offline and nobody has answered their chat yet - a brand new chat included.
-- The away greeting in the window header is easy to miss, and is not in the
-- chat or its transcript. offline_notice_message stays the wording for a chat
-- we were answering before we stepped away.
--
-- agent_offline_at is when the Online switch last went off (NULL while
-- online). It tells "we replied, then went offline" (the visitor is owed the
-- note) from "somebody is replying with the switch still off" (they are not),
-- and it starts a fresh offline spell, so a chat noted last night is noted
-- again tonight.
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "away_reply_message" TEXT NOT NULL DEFAULT 'Thanks for your message. We are away at the moment, so we cannot reply straight away.';
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "agent_offline_at" TIMESTAMPTZ;
