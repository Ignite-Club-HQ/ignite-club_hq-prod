UPDATE public.clubs
SET deleted_at = now(),
    deleted_by = NULL
WHERE deleted_at IS NULL
  AND id IN (
    'be5d49e0-9bb7-4c48-ba22-48ba30343fe2', -- Club Mode Test
    '8263e394-a811-42cf-8456-334e7c99aa7e', -- E2E Test Cricket Club
    '2cd19d7c-4fd9-48a5-a353-e5177359b3f2', -- My Second Club
    '824143a0-1d53-4046-b99f-8d77385c457b', -- Redirect Test FC
    '73695ef3-29f1-4dd2-ae1b-bb6d34f2954b', -- Regression Test Club
    'a72a7228-6529-43c0-a97c-caf456f4ce0e', -- Test
    'fc281e50-923e-402a-bc6c-e736d1034d3f', -- Test bball
    '43c7e163-9611-40ea-983b-d2f4c351b2cb', -- Test Club Trial
    '1f433f13-dc83-4918-9636-15e869a09d3f', -- Test Cricket Club
    'fc5e839a-6054-4a02-a954-beca55554003', -- Test FC Adelaide
    '5bf188d4-4aac-4788-b90d-d895575803d6'  -- Test Second Club
  );