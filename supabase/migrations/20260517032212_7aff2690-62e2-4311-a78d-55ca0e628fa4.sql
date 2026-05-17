ALTER TABLE public.clubs ALTER COLUMN listed_on_marketplace SET DEFAULT true;
UPDATE public.clubs SET listed_on_marketplace = true WHERE kind = 'full' AND listed_on_marketplace = false;