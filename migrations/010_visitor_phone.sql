-- A phone number the visitor can leave beside their name and email, so the team
-- can ring them back. Stored with no spaces or punctuation (07336123123), which
-- is how the widget and the routes tidy it before it gets here.
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "visitor_phone" TEXT;
