-- Insert an active game for Northern United Under 12 Boys team with all players
INSERT INTO active_games (
  id,
  user_id,
  team_id,
  is_active,
  pitch_state,
  timer_state
) VALUES (
  gen_random_uuid(),
  '5de133f9-e860-489f-b862-75d81454496b', -- Sage Wright as the owner
  'b6e0f54c-4449-4465-9132-e48a3d62c90b', -- Northern United Under 12 Boys
  true,
  '{
    "teamId": "b6e0f54c-4449-4465-9132-e48a3d62c90b",
    "players": [
      {"id": "5de133f9-e860-489f-b862-75d81454496b", "name": "Sage Wright", "number": 1, "position": {"x": 50, "y": 92}, "currentPitchPosition": "GK", "minutesPlayed": 0},
      {"id": "488f79a4-fc21-4907-831d-148230c8b248", "name": "Jesse Turner", "number": 2, "position": {"x": 20, "y": 75}, "currentPitchPosition": "DEF", "minutesPlayed": 0},
      {"id": "dfe12448-8ec2-4da3-95c1-e125df651d9a", "name": "Kai Mitchell", "number": 3, "position": {"x": 40, "y": 75}, "currentPitchPosition": "DEF", "minutesPlayed": 0},
      {"id": "a8cde9fb-b998-49a5-9563-3f16bd4faebc", "name": "Sydney Evans", "number": 4, "position": {"x": 60, "y": 75}, "currentPitchPosition": "DEF", "minutesPlayed": 0},
      {"id": "8e34c710-e62d-4485-a899-d0c43df935d4", "name": "Morgan Reed", "number": 5, "position": {"x": 80, "y": 75}, "currentPitchPosition": "DEF", "minutesPlayed": 0},
      {"id": "abd86701-72e2-4bf5-93c6-872b73d18542", "name": "Taylor Bell", "number": 6, "position": {"x": 20, "y": 50}, "currentPitchPosition": "MID", "minutesPlayed": 0},
      {"id": "dcb1ad0e-4450-4be1-908a-99c8931b934f", "name": "Casey Ward", "number": 7, "position": {"x": 40, "y": 50}, "currentPitchPosition": "MID", "minutesPlayed": 0},
      {"id": "e75d2e65-323c-462e-ad86-5f93bdc7e471", "name": "Alex Ross", "number": 8, "position": {"x": 60, "y": 50}, "currentPitchPosition": "MID", "minutesPlayed": 0},
      {"id": "c8dbb2ee-a0f4-421e-ab32-6958f87c20c1", "name": "Casey Long", "number": 9, "position": {"x": 80, "y": 50}, "currentPitchPosition": "MID", "minutesPlayed": 0},
      {"id": "2f5b0ba4-18aa-4b9c-a018-09ab220fd76e", "name": "Riley Davis", "number": 10, "position": {"x": 35, "y": 22}, "currentPitchPosition": "FWD", "minutesPlayed": 0},
      {"id": "84ec63b9-bd66-4aa9-a381-60faa0da5361", "name": "Jordan Butler", "number": 11, "position": {"x": 65, "y": 22}, "currentPitchPosition": "FWD", "minutesPlayed": 0},
      {"id": "59773849-b758-4ea4-86fe-ab9ffc3f82f0", "name": "Devon Fisher", "number": 12, "position": null, "minutesPlayed": 0},
      {"id": "11c856c6-be57-41b9-b697-b9d5f9d7465e", "name": "Jaden Fox", "number": 13, "position": null, "minutesPlayed": 0}
    ],
    "teamSize": "11",
    "selectedFormation": 0,
    "ballPosition": {"x": 50, "y": 50},
    "autoSubPlan": [],
    "autoSubActive": false,
    "autoSubPaused": false,
    "mockMode": false,
    "lastUpdateTime": 0
  }'::jsonb,
  '{
    "minutesPerHalf": 25,
    "currentHalf": 1,
    "elapsedSeconds": 0,
    "isRunning": false,
    "soundEnabled": true,
    "lastUpdateTime": 0,
    "teamId": "b6e0f54c-4449-4465-9132-e48a3d62c90b",
    "teamName": "Under 12 Boys"
  }'::jsonb
);