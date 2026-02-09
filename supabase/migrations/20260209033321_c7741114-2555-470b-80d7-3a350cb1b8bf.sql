-- Add muted_until column to support timed mutes
ALTER TABLE public.chat_mute_preferences
ADD COLUMN muted_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.chat_mute_preferences.muted_until IS 'When the mute expires. NULL means muted indefinitely.';

-- Update the on_team_message_created function to check muted_until
CREATE OR REPLACE FUNCTION public.on_team_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  team_name text;
  original_author_id uuid;
  mentioned_ids uuid[];
  mentioned_user_id uuid;
  member_user_id uuid;
  has_image boolean;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  SELECT name INTO team_name FROM public.teams WHERE id = NEW.team_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';
  
  -- Create notifications and send emails for all team members
  FOR member_user_id IN 
    SELECT DISTINCT ur.user_id 
    FROM public.user_roles ur
    WHERE ur.team_id = NEW.team_id 
      AND ur.user_id != NEW.author_id
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = ur.user_id AND cmp.chat_id = NEW.team_id AND cmp.chat_type = 'team'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      )
  LOOP
    -- Insert notification
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (member_user_id, 'team_message', 
      COALESCE(sender_name, 'Someone') || ' sent a message in ' || COALESCE(team_name, 'team chat'), NEW.id)
    ON CONFLICT DO NOTHING;
    
    -- Send email notification
    PERFORM public.send_message_notification_email(
      member_user_id,
      NEW.author_id,
      NEW.text,
      'team',
      NEW.team_id,
      team_name,
      NEW.id,
      has_image
    );
  END LOOP;
  
  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT author_id INTO original_author_id FROM public.team_messages WHERE id = NEW.reply_to_id;
    IF original_author_id IS NOT NULL AND original_author_id != NEW.author_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = original_author_id AND cmp.chat_id = NEW.team_id AND cmp.chat_type = 'team'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (original_author_id, 'message_reply', COALESCE(sender_name, 'Someone') || ' replied to your message', NEW.id);
      END IF;
    END IF;
  END IF;
  
  mentioned_ids := public.extract_mentioned_user_ids(NEW.text);
  FOREACH mentioned_user_id IN ARRAY mentioned_ids
  LOOP
    IF mentioned_user_id != NEW.author_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = mentioned_user_id AND cmp.chat_id = NEW.team_id AND cmp.chat_type = 'team'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (mentioned_user_id, 'message_mention', 
          COALESCE(sender_name, 'Someone') || ' mentioned you in ' || COALESCE(team_name, 'team chat'), NEW.id)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$function$;

-- Update the on_club_message_created function to check muted_until
CREATE OR REPLACE FUNCTION public.on_club_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  club_name text;
  original_author_id uuid;
  mentioned_ids uuid[];
  mentioned_user_id uuid;
  member_user_id uuid;
  has_image boolean;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  SELECT name INTO club_name FROM public.clubs WHERE id = NEW.club_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';
  
  -- Create notifications and send emails for all club members
  FOR member_user_id IN 
    SELECT DISTINCT ur.user_id 
    FROM public.user_roles ur
    WHERE ur.club_id = NEW.club_id 
      AND ur.user_id != NEW.author_id
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = ur.user_id AND cmp.chat_id = NEW.club_id AND cmp.chat_type = 'club'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      )
  LOOP
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (member_user_id, 'club_message', 
      COALESCE(sender_name, 'Someone') || ' sent a message in ' || COALESCE(club_name, 'club chat'), NEW.id)
    ON CONFLICT DO NOTHING;
    
    -- Send email notification
    PERFORM public.send_message_notification_email(
      member_user_id,
      NEW.author_id,
      NEW.text,
      'club',
      NEW.club_id,
      club_name,
      NEW.id,
      has_image
    );
  END LOOP;
  
  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT author_id INTO original_author_id FROM public.club_messages WHERE id = NEW.reply_to_id;
    IF original_author_id IS NOT NULL AND original_author_id != NEW.author_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = original_author_id AND cmp.chat_id = NEW.club_id AND cmp.chat_type = 'club'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (original_author_id, 'message_reply', COALESCE(sender_name, 'Someone') || ' replied to your message', NEW.id);
      END IF;
    END IF;
  END IF;
  
  mentioned_ids := public.extract_mentioned_user_ids(NEW.text);
  FOREACH mentioned_user_id IN ARRAY mentioned_ids
  LOOP
    IF mentioned_user_id != NEW.author_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = mentioned_user_id AND cmp.chat_id = NEW.club_id AND cmp.chat_type = 'club'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (mentioned_user_id, 'message_mention', 
          COALESCE(sender_name, 'Someone') || ' mentioned you in ' || COALESCE(club_name, 'club chat'), NEW.id)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$function$;

-- Update the on_group_message_created function to check muted_until
CREATE OR REPLACE FUNCTION public.on_group_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  group_record RECORD;
  original_author_id uuid;
  mentioned_ids uuid[];
  mentioned_user_id uuid;
  member_user_id uuid;
  has_image boolean;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  SELECT * INTO group_record FROM public.chat_groups WHERE id = NEW.group_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';
  
  -- Handle personal groups (group_members based)
  IF group_record.club_id IS NULL AND group_record.team_id IS NULL THEN
    FOR member_user_id IN 
      SELECT gm.user_id 
      FROM public.group_members gm
      WHERE gm.group_id = NEW.group_id 
        AND gm.user_id != NEW.author_id
        AND NOT EXISTS (
          SELECT 1 FROM public.chat_mute_preferences cmp
          WHERE cmp.user_id = gm.user_id AND cmp.chat_id = NEW.group_id AND cmp.chat_type = 'group'
            AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
        )
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'group_message', 
        COALESCE(sender_name, 'Someone') || ' sent a message in ' || COALESCE(group_record.name, 'a group'), NEW.id)
      ON CONFLICT DO NOTHING;
      
      -- Send email notification
      PERFORM public.send_message_notification_email(
        member_user_id,
        NEW.author_id,
        NEW.text,
        'group',
        NEW.group_id,
        group_record.name,
        NEW.id,
        has_image
      );
    END LOOP;
  ELSE
    -- Handle club/team groups (role based)
    FOR member_user_id IN 
      SELECT DISTINCT ur.user_id 
      FROM public.user_roles ur
      WHERE ur.user_id != NEW.author_id
        AND ur.role = ANY(group_record.allowed_roles)
        AND ((group_record.club_id IS NOT NULL AND ur.club_id = group_record.club_id)
          OR (group_record.team_id IS NOT NULL AND ur.team_id = group_record.team_id))
        AND NOT EXISTS (
          SELECT 1 FROM public.chat_mute_preferences cmp
          WHERE cmp.user_id = ur.user_id AND cmp.chat_id = NEW.group_id AND cmp.chat_type = 'group'
            AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
        )
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'group_message', 
        COALESCE(sender_name, 'Someone') || ' sent a message in ' || COALESCE(group_record.name, 'a group'), NEW.id)
      ON CONFLICT DO NOTHING;
      
      -- Send email notification
      PERFORM public.send_message_notification_email(
        member_user_id,
        NEW.author_id,
        NEW.text,
        'group',
        NEW.group_id,
        group_record.name,
        NEW.id,
        has_image
      );
    END LOOP;
  END IF;
  
  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT author_id INTO original_author_id FROM public.group_messages WHERE id = NEW.reply_to_id;
    IF original_author_id IS NOT NULL AND original_author_id != NEW.author_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = original_author_id AND cmp.chat_id = NEW.group_id AND cmp.chat_type = 'group'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (original_author_id, 'message_reply', COALESCE(sender_name, 'Someone') || ' replied to your message', NEW.id)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;
  
  mentioned_ids := public.extract_mentioned_user_ids(NEW.text);
  FOREACH mentioned_user_id IN ARRAY mentioned_ids
  LOOP
    IF mentioned_user_id != NEW.author_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = mentioned_user_id AND cmp.chat_id = NEW.group_id AND cmp.chat_type = 'group'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (mentioned_user_id, 'message_mention', 
          COALESCE(sender_name, 'Someone') || ' mentioned you in ' || COALESCE(group_record.name, 'a group'), NEW.id)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$function$;

-- Update the on_direct_message_created function to check muted_until
CREATE OR REPLACE FUNCTION public.on_direct_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  recipient_id uuid;
  conversation_record record;
  has_image boolean;
BEGIN
  -- Get sender name
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';
  
  -- Get conversation to find the recipient
  SELECT * INTO conversation_record FROM public.direct_conversations WHERE id = NEW.conversation_id;
  
  -- Determine the recipient (the other participant)
  IF conversation_record.participant_1 = NEW.author_id THEN
    recipient_id := conversation_record.participant_2;
  ELSE
    recipient_id := conversation_record.participant_1;
  END IF;
  
  -- Check if recipient has muted this DM conversation (and mute hasn't expired)
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_mute_preferences cmp
    WHERE cmp.user_id = recipient_id 
    AND cmp.chat_id = NEW.conversation_id
    AND cmp.chat_type = 'dm'
    AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
  ) THEN
    -- Create notification for the recipient
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (
      recipient_id, 
      'direct_message', 
      COALESCE(sender_name, 'Someone') || ' sent you a message',
      NEW.conversation_id
    );
    
    -- Send email notification
    PERFORM public.send_message_notification_email(
      recipient_id,
      NEW.author_id,
      NEW.text,
      'direct',
      NEW.conversation_id,
      NULL,
      NEW.id,
      has_image
    );
  END IF;
  
  RETURN NEW;
END;
$function$;