-- A colleague's own choice of the name visitors see on their replies, instead of
-- the first name taken from their account. One row per colleague who has set
-- one; no row means the account name is used. No foreign key to the user table
-- on purpose: this module does not reach into core's tables for its own schema,
-- and a row left behind by a deleted user does no harm.
CREATE TABLE IF NOT EXISTS "chat_agent_names" (
  "user_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
