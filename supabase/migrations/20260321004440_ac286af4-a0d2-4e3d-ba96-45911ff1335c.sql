-- Remove the duplicate trigger on notifications table.
-- There are TWO triggers calling send_push_notification(): 
-- 'on_notification_created' and 'send_push_notification_trigger'.
-- This causes DOUBLE push notifications for non-skip_push inserts.
-- Keep the newer one and drop the older duplicate.
DROP TRIGGER IF EXISTS send_push_notification_trigger ON public.notifications;