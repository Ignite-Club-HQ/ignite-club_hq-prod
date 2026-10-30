-- Deactivate the phantom Riverside FC active game row
UPDATE public.active_games
SET is_active = false, updated_at = now()
WHERE id = '85402db6-7943-4713-834d-9523b773d048';