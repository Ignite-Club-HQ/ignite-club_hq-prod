
-- Update created_by and admin_user_id for all Basket Range Cricket Club variants to Paul Cranwell
UPDATE public.clubs SET created_by = 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc', admin_user_id = 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc' WHERE id IN ('7bf22636-b9e7-40d0-8078-64771a93acf9', 'f40d29a0-d4ad-4036-a08e-7dc62942c874', '0160d811-99a3-44bd-93f6-0731694ef312');

-- Remove Renee's club_admin roles from those clubs
DELETE FROM public.user_roles WHERE user_id = '47bd3b23-6f53-4d6a-8ad9-e7e529c11d4c' AND club_id IN ('7bf22636-b9e7-40d0-8078-64771a93acf9', 'f40d29a0-d4ad-4036-a08e-7dc62942c874', '0160d811-99a3-44bd-93f6-0731694ef312');

-- Add Paul as club_admin for all three clubs (skip if already exists)
INSERT INTO public.user_roles (user_id, club_id, role)
VALUES 
  ('f51dd664-b0d5-4956-b2d5-cec9222ae3dc', '7bf22636-b9e7-40d0-8078-64771a93acf9', 'club_admin'),
  ('f51dd664-b0d5-4956-b2d5-cec9222ae3dc', 'f40d29a0-d4ad-4036-a08e-7dc62942c874', 'club_admin'),
  ('f51dd664-b0d5-4956-b2d5-cec9222ae3dc', '0160d811-99a3-44bd-93f6-0731694ef312', 'club_admin')
ON CONFLICT DO NOTHING;
