-- Show Riverside FC logo in header instead of flame fallback
UPDATE public.clubs
SET show_logo_in_header = true,
    updated_at = now()
WHERE id = '36231b76-5313-478e-b8d5-23ac4f5e8b10';