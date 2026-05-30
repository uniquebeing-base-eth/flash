
CREATE TABLE public.usernames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  username_lower text NOT NULL UNIQUE,
  tx_hash text,
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usernames_lower_idx ON public.usernames (username_lower);

GRANT SELECT, INSERT ON public.usernames TO anon, authenticated;
GRANT ALL ON public.usernames TO service_role;

ALTER TABLE public.usernames ENABLE ROW LEVEL SECURITY;

-- Public registry: anyone can read, anyone can insert (uniqueness enforced by DB constraints).
CREATE POLICY "usernames are publicly readable"
  ON public.usernames FOR SELECT
  USING (true);

CREATE POLICY "anyone can claim a username"
  ON public.usernames FOR INSERT
  WITH CHECK (
    char_length(username) BETWEEN 3 AND 24
    AND username ~ '^[A-Za-z0-9_]+$'
    AND username_lower = lower(username)
    AND wallet_address ~ '^0x[a-fA-F0-9]{40}$'
  );
