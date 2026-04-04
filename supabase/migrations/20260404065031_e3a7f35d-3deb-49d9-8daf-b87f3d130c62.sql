INSERT INTO app_settings (key, value, description)
VALUES (
  'minimum_app_version',
  '{"ios": "1.0.0", "android": "1.0.0"}'::jsonb,
  'Minimum required app version. Users on older builds will see an update prompt on launch.'
)
ON CONFLICT (key) DO NOTHING;