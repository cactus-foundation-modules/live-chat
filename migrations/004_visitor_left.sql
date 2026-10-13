-- When a visitor's last tab on the site closed. Their browser says so on its way
-- out, so the visitor list drops them at once instead of a minute and a half
-- later, and nobody says hello to an empty room. Cleared by their next check-in:
-- a reload, or a second tab still open, puts them straight back.
ALTER TABLE "chat_visitors" ADD COLUMN IF NOT EXISTS "left_at" TIMESTAMPTZ;
