-- =============================================================================
-- rr_open_pack (SPEC 7.4, 9). Called as service_role like the Edge Function.
-- Players: P = ...a1 (gold 0, jokers 0, packs ...a1 .. ...a5),
--          Q = ...a2 (one pack ...b2).
-- =============================================================================

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2');
insert into public.packs (id, user_id) values
  ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2');

set role service_role;

-- ---- Bad contents: rejected before anything is touched -------------------------
do $$
declare
  bad text;
  bad_contents constant text[] := array[
    'null', '[]', '"gold"', '42', '{}',
    '{"kind": "diamonds", "gold": 5}',
    '{"kind": "gold"}',
    '{"kind": "gold", "gold": 0}',
    '{"kind": "gold", "gold": -5}',
    '{"kind": "gold", "gold": 1.5}',
    '{"kind": "gold", "gold": "100"}',
    '{"kind": "gold", "gold": 3000000000}',
    '{"kind": "gold", "gold": 10, "jokers": 1}',
    '{"kind": "gold", "copies": 10}',
    '{"kind": "jokers", "jokers": 0}',
    '{"kind": "jokers", "gold": 1}',
    '{"kind": "cards", "copies": 3}',
    '{"kind": "cards", "card": "knight"}',
    '{"kind": "cards", "card": 7, "copies": 3}',
    '{"kind": "cards", "card": "knight", "copies": 0}',
    '{"kind": "cards", "card": "knight", "copies": 3, "level": 5}',
    '{"KIND": "gold", "gold": 5}'];
begin
  foreach bad in array bad_contents loop
    perform tests.throws_rr(
      format('select * from public.rr_open_pack(%L, %L, %L)',
             '00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', bad),
      'bad_request', format('contents %s: rr:bad_request', bad));
  end loop;
  perform tests.throws_rr(
    $q$select * from public.rr_open_pack('00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', null)$q$,
    'bad_request', 'NULL contents: rr:bad_request');
end;
$$;

select tests.throws_rr($$select * from public.rr_open_pack('00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000ff', '{"kind": "gold", "gold": 5}')$$,
                       'pack_not_found', 'unknown pack: rr:pack_not_found');
select tests.throws_rr($$select * from public.rr_open_pack('00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000b2', '{"kind": "gold", "gold": 5}')$$,
                       'pack_not_found', 'pack of Q opened by P: rr:pack_not_found');
select tests.throws_rr($$select * from public.rr_open_pack('00000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a1', '{"kind": "gold", "gold": 5}')$$,
                       'pack_not_found', 'pack of P opened by Q: rr:pack_not_found');
select tests.throws_rr($$select * from public.rr_open_pack('00000000-0000-0000-0000-0000000000ff', '30000000-0000-0000-0000-0000000000a1', '{"kind": "gold", "gold": 5}')$$,
                       'not_found', 'unknown player: rr:not_found');

-- Atomicity: the card id fails the table check only after the pack was
-- marked opened; the whole call must be undone.
select tests.throws_rr($$select * from public.rr_open_pack('00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a5', '{"kind": "cards", "card": "Dragon!", "copies": 2}')$$,
                       'bad_request', 'invalid card id (table check): rr:bad_request');

do $$
begin
  perform tests.eq(
    (select count(*) from public.packs
      where user_id = '00000000-0000-0000-0000-0000000000a1' and not opened and contents is null),
    5::bigint, 'all packs of P are still unopened after the failed calls');
  perform tests.ok(
    (select not opened and contents is null from public.packs where id = '30000000-0000-0000-0000-0000000000b2'),
    'the pack of Q is still unopened');
  perform tests.ok(
    (select gold = 0 and jokers = 0 from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
    'gold and jokers of P are unchanged');
  perform tests.eq(
    (select count(*) from public.player_cards where user_id = '00000000-0000-0000-0000-0000000000a1'),
    6::bigint, 'P still has only the six starting cards');
end;
$$;

-- ---- Card copies for an owned card ------------------------------------------------
do $$
declare
  p constant uuid := '00000000-0000-0000-0000-0000000000a1';
  r record;
  k public.packs;
begin
  -- 4.0 is a whole number; it is stored normalised as 4.
  select * into r from public.rr_open_pack(p, '30000000-0000-0000-0000-0000000000a1',
                                           '{"copies": 4.0, "card": "knight", "kind": "cards"}');
  perform tests.eq(r.card_unlocked, false, 'copies of an owned card do not unlock it');
  perform tests.eq((select copies from public.player_cards where user_id = p and card_id = 'knight'), 5,
                   'knight gets 4 copies (1 + 4)');
  select * into k from public.packs where id = '30000000-0000-0000-0000-0000000000a1';
  perform tests.ok(k.opened, 'the pack is marked opened');
  perform tests.eq(k.contents::text, '{"card": "knight", "kind": "cards", "copies": 4}',
                   'the contents are stored normalised');

  -- Double click.
  perform tests.throws_rr(
    format('select * from public.rr_open_pack(%L, %L, %L)', p, '30000000-0000-0000-0000-0000000000a1',
           '{"kind": "cards", "card": "knight", "copies": 4}'),
    'pack_already_opened', 'the same pack twice: rr:pack_already_opened');
  perform tests.throws_rr(
    format('select * from public.rr_open_pack(%L, %L, %L)', p, '30000000-0000-0000-0000-0000000000a1',
           '{"kind": "gold", "gold": 999}'),
    'pack_already_opened', 'the same pack with other contents: rr:pack_already_opened');
  perform tests.eq((select copies from public.player_cards where user_id = p and card_id = 'knight'), 5,
                   'the second call books no copies again');
  perform tests.eq((select gold from public.profiles where id = p), 0, 'the second call books no gold');
  perform tests.eq((select contents ->> 'card' from public.packs where id = '30000000-0000-0000-0000-0000000000a1'),
                   'knight', 'the second call does not overwrite the contents');
end;
$$;

-- ---- New card, gold, jokers -----------------------------------------------------------
do $$
declare
  p constant uuid := '00000000-0000-0000-0000-0000000000a1';
  r record;
begin
  select * into r from public.rr_open_pack(p, '30000000-0000-0000-0000-0000000000a2',
                                           '{"kind": "cards", "card": "dragon", "copies": 2}');
  perform tests.eq(r.card_unlocked, true, 'copies of a new card unlock it');
  perform tests.ok(
    (select level = 1 and copies = 2 and unlocked_upgrades = 0 from public.player_cards
      where user_id = p and card_id = 'dragon'),
    'the new card is stored at level 1 with the copies of the pack');

  select * into r from public.rr_open_pack(p, '30000000-0000-0000-0000-0000000000a3', '{"kind": "gold", "gold": 120}');
  perform tests.eq(r.card_unlocked, false, 'a gold pack unlocks no card');
  perform tests.eq((select gold from public.profiles where id = p), 120, 'gold pack adds the gold');
  perform tests.eq((select contents from public.packs where id = '30000000-0000-0000-0000-0000000000a3'),
                   '{"kind": "gold", "gold": 120}'::jsonb, 'gold pack stores its contents');

  select * into r from public.rr_open_pack(p, '30000000-0000-0000-0000-0000000000a4', '{"kind": "jokers", "jokers": 3}');
  perform tests.eq(r.card_unlocked, false, 'a joker pack unlocks no card');
  perform tests.eq((select jokers from public.profiles where id = p), 3, 'joker pack adds the jokers');
  perform tests.eq((select gold from public.profiles where id = p), 120, 'joker pack leaves the gold alone');

  perform tests.ok(
    (select not opened and contents is null from public.packs where id = '30000000-0000-0000-0000-0000000000b2')
    and (select gold = 0 and jokers = 0 from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'),
    'pack openings of P did not touch Q');
end;
$$;

-- ---- Onboarding end to end: name -> welcome pack -> open it ----------------------
do $$
declare
  q constant uuid := '00000000-0000-0000-0000-0000000000a2';
  u record;
  r record;
begin
  select * into u from public.rr_set_username(q, 'Quentin_a2', 1);
  select * into r from public.rr_open_pack(q, u.welcome_pack_id, '{"kind": "cards", "card": "musketeer", "copies": 1}');
  perform tests.eq(r.card_unlocked, true, 'the welcome pack unlocks the musketeer (SPEC 9)');
  perform tests.ok(
    (select opened and kind = 'welcome' from public.packs where id = u.welcome_pack_id),
    'the welcome pack is opened');
end;
$$;

reset role;
