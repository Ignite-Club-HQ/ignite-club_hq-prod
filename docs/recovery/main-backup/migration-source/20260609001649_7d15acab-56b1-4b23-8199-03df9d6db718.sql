ALTER TABLE public.duties
  ADD COLUMN IF NOT EXISTS start_time timestamptz NULL,
  ADD COLUMN IF NOT EXISTS end_time timestamptz NULL;

-- Rename existing "Canteen" duties to "Canteen/BBQ"
UPDATE public.duties SET name = 'Canteen/BBQ' WHERE name = 'Canteen';