-- Delete users Joe and Mary Mou Mou from auth.users (will cascade to profiles and related data)
DELETE FROM auth.users WHERE id IN (
  '4b6839e0-96ea-4d12-a3e9-a61b57fe7362',  -- Joe
  '5fbccccf-defc-4532-83d9-181f3253c170'   -- Mary Mou Mou
);