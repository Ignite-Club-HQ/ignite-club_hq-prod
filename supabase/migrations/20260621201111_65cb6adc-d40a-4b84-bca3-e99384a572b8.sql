REVOKE EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamptz, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.club_engagement_message_volume(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_engagement_message_volume(uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_engagement_message_volume(uuid, timestamptz, timestamptz) TO authenticated;