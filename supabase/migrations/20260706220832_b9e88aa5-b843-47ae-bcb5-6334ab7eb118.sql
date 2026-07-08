UPDATE public.clubs SET stripe_subscription_id = NULL, is_pro = false WHERE id = '493ee2e3-c834-487d-93be-d1c8a0dbc4a8';
INSERT INTO public.admin_alerts (alert_type, details) VALUES (
  'legacy_subscription_pointer_cleared',
  jsonb_build_object(
    'club_id','493ee2e3-c834-487d-93be-d1c8a0dbc4a8',
    'club_name','Basket Range Cricket Club',
    'stripe_subscription_id','sub_1TIkKcD2HIRCsShe0KIZbwJH',
    'stripe_customer_id','cus_UH8gm2IeyBwbP2',
    'note','No Stripe secret key on file (app_stripe_config and club_stripe_configs both empty). Subscription MUST be cancelled manually in Stripe dashboard; DB pointer cleared so app no longer references it.'
  )
);