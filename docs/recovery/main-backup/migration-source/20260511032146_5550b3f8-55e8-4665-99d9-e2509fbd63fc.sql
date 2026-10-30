
-- Turn off automated RSVP DMs and event chat posts for all teams
UPDATE public.teams
SET auto_rsvp_dm_enabled = false,
    auto_chat_post_enabled = false;

-- Unschedule RSVP-related cron jobs until iOS ships
SELECT cron.unschedule('auto-rsvp-dm-cron');
SELECT cron.unschedule('auto-default-rsvp-confirm-cron');
SELECT cron.unschedule('auto-default-rsvp-maintenance-cron');
