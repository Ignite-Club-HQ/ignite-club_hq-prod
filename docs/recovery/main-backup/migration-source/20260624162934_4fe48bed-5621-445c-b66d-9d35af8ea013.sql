
CREATE TABLE public.chat_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('team','club','group','club_admin','direct')),
  scope_id text NOT NULL,
  last_message_id uuid,
  message_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_summaries_user_scope_idx
  ON public.chat_summaries (user_id, scope_type, scope_id, created_at DESC);

CREATE UNIQUE INDEX chat_summaries_user_scope_msg_uk
  ON public.chat_summaries (user_id, scope_type, scope_id, COALESCE(last_message_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_summaries TO authenticated;
GRANT ALL ON public.chat_summaries TO service_role;

ALTER TABLE public.chat_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own chat summaries"
  ON public.chat_summaries FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own chat summaries"
  ON public.chat_summaries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own chat summaries"
  ON public.chat_summaries FOR DELETE TO authenticated
  USING (user_id = auth.uid());
