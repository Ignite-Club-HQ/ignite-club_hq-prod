-- Add cache-bust param to force reload of new logo
UPDATE public.clubs
SET logo_url = 'https://ignite-club-launchpad.lovable.app/riverside-fc-logo.png?v=' || extract(epoch from now())::bigint,
    updated_at = now()
WHERE id = '36231b76-5313-478e-b8d5-23ac4f5e8b10';