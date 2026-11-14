-- =============================================================================
-- TEST HELPER ONLY - never run this on Supabase.
-- Test data shared by the *.test.sql files (runs as the local superuser,
-- like Supabase Auth and the Edge Functions would). Three players:
--   A = ...0a  "Alice_1"   gold 500, jokers 3
--   B = ...0b  "Bob_2"     gold 700, jokers 5, elo 1234, arena 3
--   C = ...0c  "Carl_3"    (outsider for match and friendship checks)
-- Matches: A vs B, B vs C, A vs bot. Friendship: A -> B accepted.
-- Packs: one per player.
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

insert into public.matches (id, player_a, player_b, bot_level, seed, engine_version, result) values
  ('10000000-0000-0000-0000-0000000000ab',
   '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', null, 42, 1, 'a_won'),
  ('10000000-0000-0000-0000-0000000000bc',
   '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', null, 43, 1, 'pending'),
  ('10000000-0000-0000-0000-00000000a0b0',
   '00000000-0000-0000-0000-00000000000a', null, 'easy', 44, 1, 'b_won');

insert into public.packs (id, user_id, match_id) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-0000000000ab'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', null),
  ('20000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', null);

insert into public.friendships (user_id, friend_id, status) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted');
