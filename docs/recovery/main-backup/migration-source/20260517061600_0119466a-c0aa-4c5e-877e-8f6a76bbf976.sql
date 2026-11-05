INSERT INTO public.user_roles (user_id, team_id, club_id, role)
VALUES ('fa32292f-8011-4379-b8e6-bb6318eb25e7', '6ac22890-4f49-4fca-9ff9-69617bbb4fef', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', 'parent')
ON CONFLICT DO NOTHING;

INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES ('98eab7c2-0f5a-40bd-bf8f-062e0005ff5a', 'fa32292f-8011-4379-b8e6-bb6318eb25e7', 'parent', false)
ON CONFLICT DO NOTHING;