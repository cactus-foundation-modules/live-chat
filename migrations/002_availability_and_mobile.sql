-- Two switches the first release lacked.
--
-- agent_online: the "go offline" switch for whoever answers chats. Site-wide,
-- because a visitor cannot tell one colleague from another: when it is off the
-- widget says nobody is about, still takes a message, and is answered later.
-- ON by default so no existing site changes until somebody flips it.
--
-- hide_bubble_on_mobile: a site whose phone header carries core's Mobile Bar
-- already has a way into the chat (a cell in the bar), so the floating bubble
-- is a second launcher over the content on the smallest screen there is.
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "agent_online" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "hide_bubble_on_mobile" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "away_label" TEXT NOT NULL DEFAULT 'Leave a message';
ALTER TABLE "chat_settings" ADD COLUMN IF NOT EXISTS "away_message" TEXT NOT NULL DEFAULT 'We are away at the moment. Leave a message, and your email if you would like a reply, and we will get back to you when we are next in.';
