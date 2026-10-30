DO $$ DECLARE c uuid:='00000000-0000-0000-0000-000000000001';op uuid:=gen_random_uuid(); result integer; BEGIN
 result:=public.create_competition_event(op,c,'Canonical event','social',now()+interval '1 day',now()+interval '2 days',NULL,NULL);
 IF result<>1 OR (SELECT count(*) FROM events)<>1 OR (SELECT count(*) FROM notifications)<>1 THEN RAISE EXCEPTION 'Canonical event/queued count failed'; END IF;
 result:=public.create_competition_event(op,c,'Canonical event','social',(SELECT event_date FROM events),(SELECT end_time FROM events),NULL,NULL);
 IF result<>1 OR (SELECT count(*) FROM events)<>1 THEN RAISE EXCEPTION 'Replay duplicated event'; END IF;
 BEGIN
  PERFORM public.create_competition_event(op,c,'Changed request','social',now()+interval '1 day',now()+interval '2 days',NULL,NULL);
  RAISE EXCEPTION 'Changed replay accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 IF public.can_invite_players_to_team('00000000-0000-0000-0000-000000000011') IS NOT TRUE THEN RAISE EXCEPTION 'Own admin invitation rejected'; END IF;
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000103',false);
 IF public.can_invite_players_to_team('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000011') IS NOT FALSE THEN RAISE EXCEPTION 'Spoofed invitation authorized'; END IF;
 IF (SELECT count(*) FROM public.club_news_competition_ids('00000000-0000-0000-0000-000000000010'))<>0 THEN RAISE EXCEPTION 'Outsider discovered club competitions'; END IF;
 IF public.can_access_competition_vault(c) IS NOT FALSE THEN RAISE EXCEPTION 'Outsider Vault authorized'; END IF;
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000101',false);
 IF (SELECT count(*) FROM public.club_news_competition_ids('00000000-0000-0000-0000-000000000010'))<>1 THEN RAISE EXCEPTION 'Member discovery failed'; END IF;
 IF public.can_manage_competition_vault(c) IS NOT TRUE THEN RAISE EXCEPTION 'Manager Vault rejected'; END IF;
END; $$;
INSERT INTO club_news VALUES('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000101','News',false,false,now(), '00000000-0000-0000-0000-000000000001',NULL,NULL);
DO $$ DECLARE n uuid:='00000000-0000-0000-0000-000000000201'; BEGIN
 IF public.notify_club_news(n,false)<>0 OR public.notify_competition_news(n,false)<>0 THEN RAISE EXCEPTION 'Draft notified'; END IF;
 UPDATE club_news SET is_published=true,published_at=now()+interval '1 day' WHERE id=n;
 IF public.notify_competition_news(n,false)<>0 THEN RAISE EXCEPTION 'Future post notified'; END IF;
 UPDATE club_news SET published_at=now()-interval '1 minute' WHERE id=n;
 IF public.notify_competition_news(n,false)<>1 THEN RAISE EXCEPTION 'Published news count failed'; END IF;
 IF public.notify_club_news(n,false)<>0 THEN RAISE EXCEPTION 'Cross API duplicate notifications'; END IF;
 IF NOT EXISTS(SELECT 1 FROM notifications WHERE related_id=n AND skip_push AND user_id='00000000-0000-0000-0000-000000000102') THEN RAISE EXCEPTION 'Push off lost in-app notification'; END IF;
 IF EXISTS(SELECT 1 FROM notifications WHERE related_id=n AND user_id='00000000-0000-0000-0000-000000000101') THEN RAISE EXCEPTION 'Author notified'; END IF;
END; $$;
SELECT 'PASS: canonical event replay, caller-bound invitations, scoped discovery, news dedupe/publication and manager Vault helpers' AS result;