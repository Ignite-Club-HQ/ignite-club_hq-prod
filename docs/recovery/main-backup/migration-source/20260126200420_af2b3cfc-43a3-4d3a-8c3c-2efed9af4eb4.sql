-- Clean up orphaned photo record with null file_url
DELETE FROM photos WHERE id = '2b254d02-ea77-4971-9ec3-968e14ae73da';

-- Reset storage for Bridgewater Soccer Club since no valid files exist
UPDATE clubs SET storage_used_bytes = 0 WHERE id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422';

-- Delete orphaned storage object
DELETE FROM storage.objects 
WHERE bucket_id = 'photos' 
AND name = 'clubs/966bdaec-ebf1-46da-b2b3-cc53bf05c422/teams/21d78a5b-4923-4634-acfe-8d38ae4dbf01/f51dd664-b0d5-4956-b2d5-cec9222ae3dc/1769424327837-tkvvk.png';