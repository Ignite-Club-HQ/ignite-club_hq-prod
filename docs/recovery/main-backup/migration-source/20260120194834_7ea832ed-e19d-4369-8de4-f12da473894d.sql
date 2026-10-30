-- Create function to notify on direct message creation
CREATE OR REPLACE FUNCTION public.on_direct_message_created()
RETURNS TRIGGER AS $$
DECLARE
  sender_name text;
  recipient_id uuid;
  conversation_record record;
BEGIN
  -- Get sender name
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  
  -- Get conversation to find the recipient
  SELECT * INTO conversation_record FROM public.direct_conversations WHERE id = NEW.conversation_id;
  
  -- Determine the recipient (the other participant)
  IF conversation_record.participant_1 = NEW.author_id THEN
    recipient_id := conversation_record.participant_2;
  ELSE
    recipient_id := conversation_record.participant_1;
  END IF;
  
  -- Check if recipient has muted this DM conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_mute_preferences cmp
    WHERE cmp.user_id = recipient_id 
    AND cmp.chat_id = NEW.conversation_id::text 
    AND cmp.chat_type = 'dm'
  ) THEN
    -- Create notification for the recipient
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (
      recipient_id, 
      'direct_message', 
      COALESCE(sender_name, 'Someone') || ' sent you a message',
      NEW.conversation_id
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to call the function on new direct messages
CREATE TRIGGER on_direct_message_created_trigger
AFTER INSERT ON public.direct_messages
FOR EACH ROW
EXECUTE FUNCTION public.on_direct_message_created();