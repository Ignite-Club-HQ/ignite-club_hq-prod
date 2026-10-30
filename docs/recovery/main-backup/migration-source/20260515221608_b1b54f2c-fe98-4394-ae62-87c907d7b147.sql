UPDATE public.events
SET start_time = NULL,
    updated_at = now()
WHERE id = '4645ca4b-699d-4f6e-b186-34df374f311e'
  AND team_id = '76d94b7a-baf5-4867-8015-92fe620b3a97'
  AND opponent = 'Rangers JSC'
  AND type = 'game';