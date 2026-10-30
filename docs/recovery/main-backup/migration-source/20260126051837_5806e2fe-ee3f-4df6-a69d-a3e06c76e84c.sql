-- Delete user "Snake" (18e13f49-d967-4fa6-bbb1-82c231e337b6) and all related data

-- 1. Delete user roles
DELETE FROM public.user_roles WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 2. Delete notifications
DELETE FROM public.notifications WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 3. Delete push subscriptions
DELETE FROM public.push_subscriptions WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 4. Delete notification preferences
DELETE FROM public.notification_preferences WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 5. Delete RSVPs
DELETE FROM public.rsvps WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 6. Delete chat mute preferences
DELETE FROM public.chat_mute_preferences WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 7. Delete message reads
DELETE FROM public.message_reads WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 8. Delete message reactions
DELETE FROM public.message_reactions WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 9. Delete photo reactions
DELETE FROM public.photo_reactions WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 10. Delete photo comment reactions
DELETE FROM public.photo_comment_reactions WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 11. Delete photo comments
DELETE FROM public.photo_comments WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 12. Delete feedback
DELETE FROM public.feedback WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 13. Delete group members
DELETE FROM public.group_members WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 14. Delete pending invites
DELETE FROM public.pending_invites WHERE invited_user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';
DELETE FROM public.pending_invites WHERE invited_by_user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 15. Delete favorite event titles
DELETE FROM public.favorite_event_titles WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 16. Delete favorite opponents
DELETE FROM public.favorite_opponents WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 17. Delete active games
DELETE FROM public.active_games WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 18. Delete game summaries
DELETE FROM public.game_summaries WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 19. Delete game player stats
DELETE FROM public.game_player_stats WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 20. Delete player of match
DELETE FROM public.player_of_match WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 21. Delete event payments
DELETE FROM public.event_payments WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 22. Delete member subscription payments
DELETE FROM public.member_subscription_payments WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 23. Delete reward redemptions
DELETE FROM public.reward_redemptions WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 24. Delete role requests
DELETE FROM public.role_requests WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 25. Delete pitch formations
DELETE FROM public.pitch_formations WHERE user_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 26. Unassign duties
UPDATE public.duties SET assigned_to = NULL WHERE assigned_to = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 27. Delete children and their assignments
DELETE FROM public.child_team_assignments WHERE child_id IN (SELECT id FROM public.children WHERE parent_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6');
DELETE FROM public.child_guardians WHERE guardian_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';
DELETE FROM public.children WHERE parent_id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 28. Delete profile
DELETE FROM public.profiles WHERE id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';

-- 29. Delete auth user
DELETE FROM auth.users WHERE id = '18e13f49-d967-4fa6-bbb1-82c231e337b6';