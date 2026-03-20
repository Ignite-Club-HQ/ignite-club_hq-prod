
-- Re-attach the push notification trigger to the notifications table
CREATE TRIGGER on_notification_created
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.send_push_notification();
