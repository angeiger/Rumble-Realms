-- =============================================================================
-- TEST HELPER ONLY - never run this on Supabase.
-- Test data shared by the *.test.sql files (runs as the local superuser,
-- like Supabase Auth and the Edge Functions would). Three players:
--   A = ...0a  "Alice_1"   gold 500, jokers 3
--   B = ...0b  "Bob_2"     gold 700, jokers 5, elo 1234, arena 3
--   C = ...0c  "Carl_3"    (outsider for match and friendship checks)
-- Matches: A vs B (finished), B vs C (pending), A vs bot (finished).
-- Friendship: A -> B accepted. Packs: one per player (B's is a welcome pack).
-- The functions of migration section 7 are tested with their own players in
-- 06_* and later, so these fixtures stay as they are.
-- =============================================================================

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', null),
  ('00000000-0000-0000-0000-00000000000b', null),
  ('00000000-0000-0000-0000-00000000000c', null);

update public.profiles set username = 'Alice_1', gold = 500, jokers = 3
  where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set username = 'Bob_2', gold = 700, jokers = 5, elo = 1234, highest_arena = 3
  where id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set username = 'Carl_3'
  where id = '00000000-0000-0000-0000-00000000000c';

insert into public.matches
  (id, player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, result, finished_at) values
  ('10000000-0000-0000-0000-0000000000ab',
   '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', null, null, 42, 1,
   '{"deck": ["archer", "knight", "skeleton", "healer"], "levels": {}, "upgrades": {}}', 'a_won', now()),
  ('10000000-0000-0000-0000-0000000000bc',
   '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', null, null, 43, 1,
   '{"deck": ["archer", "knight", "skeleton", "healer"], "levels": {}, "upgrades": {}}', 'pending', null),
  ('10000000-0000-0000-0000-00000000a0b0',
   '00000000-0000-0000-0000-00000000000a', null, 'easy', 'goblin-gustav', 44, 1,
   '{"deck": ["archer", "knight", "skeleton", "healer"], "levels": {}, "upgrades": {}}', 'b_won', now());

insert into public.packs (id, user_id, kind, match_id) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'match',
   '10000000-0000-0000-0000-0000000000ab'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'welcome', null),
  ('20000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'match', null);

insert into public.friendships (user_id, friend_id, status) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted');
