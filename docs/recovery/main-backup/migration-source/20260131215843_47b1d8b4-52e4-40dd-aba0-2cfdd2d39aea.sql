-- Update all existing welcome messages to use markdown format with clickable links
UPDATE public.system_messages
SET text = 'Welcome to Ignite Club HQ! 🔥 For tips on how to use all of the app''s features and help run your club in one place, visit https://igniteclubhq.com/videos

For the latest news, join us on [Facebook page](https://www.facebook.com/share/1BHVkXuKNz/)'
WHERE message_type = 'welcome';