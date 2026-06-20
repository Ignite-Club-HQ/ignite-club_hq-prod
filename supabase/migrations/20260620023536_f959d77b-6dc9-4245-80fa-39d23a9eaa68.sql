
CREATE TABLE IF NOT EXISTS public.playhq_player_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant text NOT NULL,
  playhq_player_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.children(id) ON DELETE CASCADE,
  claimed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playhq_player_links_target_check
    CHECK ((user_id IS NOT NULL)::int + (child_id IS NOT NULL)::int = 1),
  CONSTRAINT playhq_player_links_unique
    UNIQUE (tenant, playhq_player_id, user_id, child_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playhq_player_links TO authenticated;
GRANT ALL ON public.playhq_player_links TO service_role;

ALTER TABLE public.playhq_player_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own player links"
  ON public.playhq_player_links FOR SELECT
  TO authenticated
  USING (
    claimed_by = auth.uid()
    OR user_id = auth.uid()
    OR (child_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.child_guardians cg
      WHERE cg.child_id = playhq_player_links.child_id AND cg.guardian_id = auth.uid()
    ))
  );

CREATE POLICY "Users can claim a player link for themselves or their child"
  ON public.playhq_player_links FOR INSERT
  TO authenticated
  WITH CHECK (
    claimed_by = auth.uid()
    AND (
      user_id = auth.uid()
      OR (child_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.child_guardians cg
        WHERE cg.child_id = playhq_player_links.child_id AND cg.guardian_id = auth.uid()
      ))
    )
  );

CREATE POLICY "Claimer can remove their own link"
  ON public.playhq_player_links FOR DELETE
  TO authenticated
  USING (claimed_by = auth.uid());

CREATE INDEX IF NOT EXISTS playhq_player_links_lookup_idx
  ON public.playhq_player_links (tenant, playhq_player_id);

CREATE OR REPLACE FUNCTION public.set_playhq_player_links_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_playhq_player_links_updated_at ON public.playhq_player_links;
CREATE TRIGGER trg_playhq_player_links_updated_at
  BEFORE UPDATE ON public.playhq_player_links
  FOR EACH ROW EXECUTE FUNCTION public.set_playhq_player_links_updated_at();
