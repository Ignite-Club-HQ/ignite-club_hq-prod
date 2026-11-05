-- Brighten Riverside FC light mode: vivid royal blue + warm amber gold
UPDATE public.clubs
SET
  theme_primary_h = 215,
  theme_primary_s = 80,
  theme_primary_l = 48,
  theme_secondary_h = 38,
  theme_secondary_s = 92,
  theme_secondary_l = 50,
  theme_accent_h = 38,
  theme_accent_s = 92,
  theme_accent_l = 50,
  updated_at = now()
WHERE id = '36231b76-5313-478e-b8d5-23ac4f5e8b10';