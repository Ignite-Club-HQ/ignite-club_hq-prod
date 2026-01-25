-- Delete user icpchainapps@gmail.com (ID: 267c92d3-43e0-4b69-8f46-1a91266b56df)

-- Delete from profiles first (will cascade or handle related data)
DELETE FROM public.profiles WHERE id = '267c92d3-43e0-4b69-8f46-1a91266b56df';

-- Delete from auth.users
DELETE FROM auth.users WHERE id = '267c92d3-43e0-4b69-8f46-1a91266b56df';