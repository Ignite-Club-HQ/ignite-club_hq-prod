-- 1. Harden the IAP transaction log with verified store facts
ALTER TABLE public.iap_transactions
  ADD COLUMN IF NOT EXISTS purchase_token text,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchased_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS store_status text,
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS storage_gb integer;

CREATE UNIQUE INDEX IF NOT EXISTS iap_transactions_platform_transaction_key
  ON public.iap_transactions (platform, transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS iap_transactions_platform_purchase_token_key
  ON public.iap_transactions (platform, purchase_token)
  WHERE purchase_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_iap_transactions_entity
  ON public.iap_transactions (entity_type, entity_id, created_at DESC);

-- 2. Atomic application of a store-verified purchase
CREATE OR REPLACE FUNCTION public.apply_verified_iap_purchase(p_facts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_platform text := p_facts->>'platform';
  v_transaction_id text := nullif(p_facts->>'transaction_id', '');
  v_original_transaction_id text := nullif(p_facts->>'original_transaction_id', '');
  v_purchase_token text := nullif(p_facts->>'purchase_token', '');
  v_product_id text := nullif(p_facts->>'product_id', '');
  v_entity_id uuid;
  v_entity_type text := p_facts->>'entity_type';
  v_tier text := p_facts->>'tier';
  v_plan text := nullif(p_facts->>'plan', '');
  v_storage_gb integer := nullif(p_facts->>'storage_gb', '')::integer;
  v_is_storage boolean := coalesce((p_facts->>'is_storage')::boolean, false);
  v_expires_at timestamptz := nullif(p_facts->>'expires_at', '')::timestamptz;
  v_purchased_at timestamptz := coalesce(nullif(p_facts->>'purchased_at', '')::timestamptz, now());
  v_environment text := nullif(p_facts->>'environment', '');
  v_store_status text := nullif(p_facts->>'store_status', '');
  v_team_limit integer;
  v_existing public.iap_transactions;
  v_inserted uuid;
BEGIN
  BEGIN
    v_user_id := (p_facts->>'user_id')::uuid;
    v_entity_id := (p_facts->>'entity_id')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid_purchase_facts';
  END;

  IF v_user_id IS NULL OR v_entity_id IS NULL OR v_transaction_id IS NULL OR v_product_id IS NULL THEN
    RAISE EXCEPTION 'invalid_purchase_facts';
  END IF;
  IF v_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid_platform';
  END IF;
  IF v_entity_type NOT IN ('club', 'team') THEN
    RAISE EXCEPTION 'invalid_entity_type';
  END IF;
  IF v_tier NOT IN ('pro', 'pro_football') THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;
  IF v_plan IS NOT NULL AND v_plan NOT IN ('starter', 'standard', 'unlimited') THEN
    RAISE EXCEPTION 'invalid_plan';
  END IF;
  IF v_is_storage THEN
    IF v_entity_type <> 'club' OR v_storage_gb IS NULL OR v_storage_gb <= 0 THEN
      RAISE EXCEPTION 'invalid_storage_allocation';
    END IF;
  END IF;

  -- Validate the target entity exists
  IF v_entity_type = 'club' THEN
    IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = v_entity_id) THEN
      RAISE EXCEPTION 'unknown_club';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_entity_id) THEN
      RAISE EXCEPTION 'unknown_team';
    END IF;
  END IF;

  -- Replay / idempotency check
  SELECT * INTO v_existing
  FROM public.iap_transactions
  WHERE platform = v_platform
    AND (transaction_id = v_transaction_id
         OR (v_purchase_token IS NOT NULL AND purchase_token = v_purchase_token))
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id IS DISTINCT FROM v_user_id
       OR v_existing.entity_id IS DISTINCT FROM v_entity_id
       OR v_existing.entity_type IS DISTINCT FROM v_entity_type
       OR v_existing.product_id IS DISTINCT FROM v_product_id THEN
      RAISE EXCEPTION 'transaction_conflict';
    END IF;
    RETURN jsonb_build_object('applied', false, 'idempotent', true);
  END IF;

  BEGIN
    INSERT INTO public.iap_transactions (
      user_id, transaction_id, original_transaction_id, purchase_token, product_id,
      platform, entity_id, entity_type, status, environment, verified_at,
      purchased_at, expires_at, store_status, tier, plan, storage_gb
    ) VALUES (
      v_user_id, v_transaction_id, v_original_transaction_id, v_purchase_token, v_product_id,
      v_platform, v_entity_id, v_entity_type, 'completed', v_environment, now(),
      v_purchased_at, v_expires_at, v_store_status, v_tier, v_plan, v_storage_gb
    )
    RETURNING id INTO v_inserted;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'transaction_conflict';
  END;

  IF v_is_storage THEN
    UPDATE public.club_subscriptions
    SET storage_purchased_gb = coalesce(storage_purchased_gb, 0) + v_storage_gb,
        updated_at = now()
    WHERE club_id = v_entity_id;

    IF NOT FOUND THEN
      INSERT INTO public.club_subscriptions (club_id, plan, storage_purchased_gb)
      VALUES (v_entity_id, 'starter'::subscription_plan, v_storage_gb);
    END IF;

  ELSIF v_entity_type = 'club' THEN
    v_team_limit := CASE v_plan
      WHEN 'starter' THEN 10
      WHEN 'standard' THEN 20
      ELSE NULL
    END;

    INSERT INTO public.club_subscriptions (
      club_id, plan, team_limit, is_pro, is_pro_football,
      activated_at, expires_at, stripe_subscription_id, updated_at
    ) VALUES (
      v_entity_id,
      coalesce(v_plan, 'starter')::subscription_plan,
      v_team_limit,
      true,
      v_tier = 'pro_football',
      now(),
      v_expires_at,
      'iap_' || v_platform || '_' || v_transaction_id,
      now()
    )
    ON CONFLICT (club_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      team_limit = EXCLUDED.team_limit,
      is_pro = true,
      is_pro_football = EXCLUDED.is_pro_football,
      activated_at = EXCLUDED.activated_at,
      expires_at = EXCLUDED.expires_at,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      cancelled_at = NULL,
      updated_at = now();

    UPDATE public.clubs SET is_pro = true WHERE id = v_entity_id;

  ELSE
    INSERT INTO public.team_subscriptions (
      team_id, is_pro, is_pro_football, expires_at, updated_at
    ) VALUES (
      v_entity_id, true, v_tier = 'pro_football', v_expires_at, now()
    )
    ON CONFLICT (team_id) DO UPDATE SET
      is_pro = true,
      is_pro_football = EXCLUDED.is_pro_football,
      expires_at = EXCLUDED.expires_at,
      cancelled_at = NULL,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object('applied', true, 'transaction_row_id', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_verified_iap_purchase(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_verified_iap_purchase(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_verified_iap_purchase(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_iap_purchase(jsonb) TO service_role;