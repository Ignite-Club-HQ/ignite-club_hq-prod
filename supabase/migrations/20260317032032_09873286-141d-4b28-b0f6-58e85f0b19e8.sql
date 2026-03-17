-- Clean up test notifications created during scalability testing
DELETE FROM notifications 
WHERE related_id IN (
  'b99cdb21-e531-4098-a36b-3290c4659e00',
  'b99cdb21-e531-4098-a36b-3290c4659e01', 
  'b99cdb21-e531-4098-a36b-3290c4659e02'
);