INSERT INTO public.app_settings (key, value, description)
VALUES (
  'notification_prefetch_enabled',
  'true'::jsonb,
  'When true, native push notification receipt (foreground/background) warms the target chat page JS chunk via a dynamic import so the tap→paint gap is smaller. Kill-switch: set to false to fall back to tap-time-only prefetch.'
)
ON CONFLICT (key) DO NOTHING;