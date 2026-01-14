-- Add players to teams that don't have any
-- Each team gets 13 players for a full squad

-- Varsity Boys (Eastside Athletic) - 26755f6b-4c33-4eb8-9c2f-66ed5407fad0
INSERT INTO user_roles (user_id, team_id, role) VALUES
('9a4a3b58-2776-411f-b88f-d7d73e4e7945', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Alex Cooper
('1abd97c8-e362-4c3a-96e8-e42eef3d462f', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Alex Johnson
('77d8b20b-2747-4c74-8729-ada12d999b1e', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Alex Perry
('72c936aa-d4ca-4df6-87d7-67e87ff5c953', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Ashton Cole
('149a34a9-d5f2-48b6-8b50-f7ff55614f87', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Avery Martinez
('e48cec67-5515-406f-bce8-c7e46f3a5be4', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Bailey Phillips
('71ced7ca-9528-4600-8780-1d4789ddc42c', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Blake Moore
('db398dab-3146-4264-bc18-13745f5151f2', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Briar Mills
('7100555f-6f36-4431-af38-472f353f9eb5', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Cameron White
('7e31ba55-cd7e-4a1a-b297-98a1faa1df4c', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Carson Nash
('6c3e7349-6979-4335-b634-24d605951f30', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Casey Barnes
('4a91ce0a-0a58-4d9a-8537-cfddad8ee1eb', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player'), -- Casey Brown
('6d8dad5d-fad7-46d9-aa79-75580c96da2c', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', 'player') -- Casey Stewart
ON CONFLICT DO NOTHING;

-- Varsity Girls (Eastside Athletic) - 2e945451-afc6-488d-abce-090e28baf135
INSERT INTO user_roles (user_id, team_id, role) VALUES
('ecced09a-a568-416c-b194-6312e9a5f91f', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Charlie Anderson
('90d9ac1c-7f47-4a22-aa1d-4897093445ea', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Dakota Scott
('432e1e89-f128-4233-a47e-d268004fdcca', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Drew Jackson
('41841606-85f2-4b71-a2bd-9a840b62a458', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Eden Quinn
('c8b9eabc-3df0-42fe-8c22-c3dbaea1cc95', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Ellis Grant
('dc63474f-7d6b-442d-84cf-fe04e79794f2', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Emery Hall
('7787b3ec-568a-4030-8bf6-19475c061ad4', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Finley Green
('be46cc01-445c-4fcf-9806-9e5f9a631a02', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Flynn Rose
('91822c09-d601-4f8b-ae19-18c5e390d99f', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Harper Diaz
('617e4f65-21ab-4389-9b3e-5e6dddd5489a', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Haven Storm
('e6ce98f6-16d5-460b-8624-c2d05735d949', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Hayden King
('28c4ed96-3798-44d6-b021-8fa16faa5ede', '2e945451-afc6-488d-abce-090e28baf135', 'player'), -- Indigo Todd
('aef36a61-2e6d-461b-9392-c7563ba1aba5', '2e945451-afc6-488d-abce-090e28baf135', 'player') -- Jamie Garcia
ON CONFLICT DO NOTHING;

-- Under 10 Girls (Northern United) - a22f738b-280c-4e76-a846-caddd2f76f73
INSERT INTO user_roles (user_id, team_id, role) VALUES
('807fec96-1b40-4844-8a1d-a37d3d6f169f', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Jordan Collins
('2399a0d5-2b0c-40d9-9be7-413cd151e99a', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Jordan Hayes
('d45238f4-449f-4c21-8a5a-d2a50a0612e3', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Jordan Howard
('102433ce-edd5-466c-a094-c60b68e916d3', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Jordan Taylor
('031adb22-f90b-4830-b33b-5f9ee3172c11', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Jules Vale
('279d5ee3-c4d1-4fd2-b9b6-a52275a4e47d', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Kelsey Hart
('d9648f12-e60a-4994-8515-a76bab7d68b0', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Kendall Hill
('59750bf3-6723-4ac1-a34a-e21469239ecb', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Kerry Webb
('dc7cec23-4c7e-48d8-adc1-cd603c80a15a', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Logan Roberts
('a7411ee3-5614-4fa0-8ed2-5b4729d78e36', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Marley Nash
('9f1e4bcc-3307-43b6-8888-13052de1de25', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Micah Campbell
('55dbbaf2-835a-4c01-b062-9b0d7fde21d2', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player'), -- Morgan Brooks
('34005394-2ac3-480a-ac60-9c1e3cba1899', 'a22f738b-280c-4e76-a846-caddd2f76f73', 'player') -- Morgan Foster
ON CONFLICT DO NOTHING;

-- Under 14 Mixed (Northern United) - a5605fc0-b897-4755-a8fd-581b42a5dac1
INSERT INTO user_roles (user_id, team_id, role) VALUES
('161a1b4a-1589-44f7-a420-89026ec2f3a0', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Morgan Smith
('8c28334c-d1da-4d2c-be65-0028b352d0d0', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Nico Stone
('e0816710-359a-4708-a667-f50d414abd4e', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Parker Lee
('0870daf8-8c4e-4461-b9ed-31a3894c1a93', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Peyton Baker
('403c61c6-7342-4bb6-a8cb-5dd0620cfdb3', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Phoenix Young
('1f41d5e7-25e6-41c8-96a9-3379269dd27c', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Presley Black
('c1b14619-4b3a-4975-9977-fb41d8ba6915', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Quinn Wilson
('cf24e8f5-e380-4383-83b4-a5e5077f73be', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Reagan Cruz
('42818e6c-5b25-463d-b57d-1169a7a69476', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Reese Clark
('9a4a3b58-2776-411f-b88f-d7d73e4e7945', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Alex Cooper
('1abd97c8-e362-4c3a-96e8-e42eef3d462f', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Alex Johnson
('77d8b20b-2747-4c74-8729-ada12d999b1e', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player'), -- Alex Perry
('72c936aa-d4ca-4df6-87d7-67e87ff5c953', 'a5605fc0-b897-4755-a8fd-581b42a5dac1', 'player') -- Ashton Cole
ON CONFLICT DO NOTHING;

-- Under 10 Girls (Riverside FC) - 2a8f1436-9be3-419c-a545-f948afc6739b
INSERT INTO user_roles (user_id, team_id, role) VALUES
('149a34a9-d5f2-48b6-8b50-f7ff55614f87', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Avery Martinez
('e48cec67-5515-406f-bce8-c7e46f3a5be4', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Bailey Phillips
('71ced7ca-9528-4600-8780-1d4789ddc42c', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Blake Moore
('db398dab-3146-4264-bc18-13745f5151f2', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Briar Mills
('7100555f-6f36-4431-af38-472f353f9eb5', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Cameron White
('7e31ba55-cd7e-4a1a-b297-98a1faa1df4c', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Carson Nash
('6c3e7349-6979-4335-b634-24d605951f30', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Casey Barnes
('4a91ce0a-0a58-4d9a-8537-cfddad8ee1eb', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Casey Brown
('6d8dad5d-fad7-46d9-aa79-75580c96da2c', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Casey Stewart
('ecced09a-a568-416c-b194-6312e9a5f91f', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Charlie Anderson
('90d9ac1c-7f47-4a22-aa1d-4897093445ea', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Dakota Scott
('432e1e89-f128-4233-a47e-d268004fdcca', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player'), -- Drew Jackson
('41841606-85f2-4b71-a2bd-9a840b62a458', '2a8f1436-9be3-419c-a545-f948afc6739b', 'player') -- Eden Quinn
ON CONFLICT DO NOTHING;

-- Under 12 Boys (Riverside FC) - f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e
INSERT INTO user_roles (user_id, team_id, role) VALUES
('c8b9eabc-3df0-42fe-8c22-c3dbaea1cc95', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Ellis Grant
('dc63474f-7d6b-442d-84cf-fe04e79794f2', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Emery Hall
('7787b3ec-568a-4030-8bf6-19475c061ad4', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Finley Green
('be46cc01-445c-4fcf-9806-9e5f9a631a02', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Flynn Rose
('91822c09-d601-4f8b-ae19-18c5e390d99f', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Harper Diaz
('617e4f65-21ab-4389-9b3e-5e6dddd5489a', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Haven Storm
('e6ce98f6-16d5-460b-8624-c2d05735d949', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Hayden King
('28c4ed96-3798-44d6-b021-8fa16faa5ede', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Indigo Todd
('aef36a61-2e6d-461b-9392-c7563ba1aba5', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Jamie Garcia
('807fec96-1b40-4844-8a1d-a37d3d6f169f', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Jordan Collins
('2399a0d5-2b0c-40d9-9be7-413cd151e99a', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Jordan Hayes
('d45238f4-449f-4c21-8a5a-d2a50a0612e3', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player'), -- Jordan Howard
('102433ce-edd5-466c-a094-c60b68e916d3', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', 'player') -- Jordan Taylor
ON CONFLICT DO NOTHING;