-- =============================================================================
-- rr_set_deck, rr_level_up_card, rr_unlock_upgrade, rr_spend_jokers
-- (SPEC 7.1-7.4). Called as service_role like the Edge Function does.
-- Players: K = ...81 (gold 1000, jokers 5, archer with 10 copies),
--          L = ...82 (owns musketeer, which K does not own).
-- =============================================================================

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000081'),
  ('00000000-0000-0000-0000-000000000082');
update public.profiles set gold = 1000, jokers = 5 where id = '00000000-0000-0000-0000-000000000081';
update public.player_cards set copies = 10
  where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'archer';
insert into public.player_cards (user_id, card_id, copies) values
  ('00000000-0000-0000-0000-000000000082', 'musketeer', 7);

set role service_role;

-- =============================================================================
-- rr_set_deck
-- =============================================================================
do $$
begin
  perform tests.eq(
    public.rr_set_deck('00000000-0000-0000-0000-000000000081', array['bat', 'tnt', 'knight', 'archer']),
    array['bat', 'tnt', 'knight', 'archer'],
    'rr_set_deck returns the new deck');
  perform tests.eq((select cards from public.decks where user_id = '00000000-0000-0000-0000-000000000081'),
                   array['bat', 'tnt', 'knight', 'archer'], 'rr_set_deck stores the deck in this order');
end;
$$;

select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', array['bat','tnt','knight','dragon'])$$,
                       'deck_invalid', 'deck with an unknown card: rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', array['bat','tnt','knight','musketeer'])$$,
                       'deck_invalid', 'deck with a card only L owns: rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', array['bat','tnt','knight'])$$,
                       'deck_invalid', 'deck with 3 cards: rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', array['bat','tnt','knight','archer','healer'])$$,
                       'deck_invalid', 'deck with 5 cards: rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', array['bat','bat','knight','archer'])$$,
                       'deck_invalid', 'deck with a duplicate: rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', array['bat','tnt',null,'archer'])$$,
                       'deck_invalid', 'deck with an empty slot: rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', null)$$,
                       'deck_invalid', 'NULL deck: rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', '{{bat,tnt},{knight,archer}}')$$,
                       'deck_invalid', 'two-dimensional deck of owned cards (table check): rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-000000000081', '[0:3]={bat,tnt,knight,healer}')$$,
                       'deck_invalid', 'deck with shifted bounds (table check): rr:deck_invalid');
select tests.throws_rr($$select public.rr_set_deck('00000000-0000-0000-0000-0000000000ff', array['bat','tnt','knight','archer'])$$,
                       'not_found', 'unknown player: rr:not_found');

do $$
begin
  perform tests.eq((select cards from public.decks where user_id = '00000000-0000-0000-0000-000000000081'),
                   array['bat', 'tnt', 'knight', 'archer'], 'failed rr_set_deck calls leave the deck unchanged');
  perform tests.eq((select cards from public.decks where user_id = '00000000-0000-0000-0000-000000000082'),
                   array['archer', 'knight', 'skeleton', 'healer'], 'rr_set_deck for K did not touch the deck of L');
end;
$$;

-- =============================================================================
-- rr_level_up_card
-- =============================================================================
do $$
declare
  r record;
begin
  select * into r from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'archer', 1, 5, 100);
  perform tests.ok(r.level = 2 and r.copies = 5 and r.gold = 900,
                   format('level-up returns level 2, 5 copies, 900 gold (got %s)', r));
  perform tests.ok(
    (select level = 2 and copies = 5 from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'archer'),
    'level-up is stored on the card');
  perform tests.eq((select gold from public.profiles where id = '00000000-0000-0000-0000-000000000081'), 900,
                   'level-up gold is taken from the profile');
end;
$$;

-- Same call again (double click): the level is no longer 1.
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'archer', 1, 5, 100)$$,
                       'stale', 'the same level-up twice: rr:stale');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'dragon', 1, 0, 0)$$,
                       'card_not_owned', 'level-up of an unknown card: rr:card_not_owned');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'musketeer', 1, 0, 0)$$,
                       'card_not_owned', 'level-up of a card only L owns: rr:card_not_owned');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'knight', 1, 5, 100)$$,
                       'not_enough_copies', 'knight has 1 copy, needs 5: rr:not_enough_copies');
-- Atomicity: enough copies, too little gold -> neither copies nor gold change.
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'archer', 2, 5, 5000)$$,
                       'not_enough_gold', 'archer 2 -> 3 for 5000 gold with 900: rr:not_enough_gold');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'archer', 2, -1, 0)$$,
                       'bad_request', 'negative copies: rr:bad_request');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'archer', 2, 0, -1)$$,
                       'bad_request', 'negative gold: rr:bad_request');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'archer', -2, 0, 0)$$,
                       'bad_request', 'negative level: rr:bad_request');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', 'archer', 5, 0, 0)$$,
                       'bad_request', 'level-up from level 5: rr:bad_request');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000081', null, 1, 0, 0)$$,
                       'bad_request', 'NULL card: rr:bad_request');
select tests.throws_rr($$select * from public.rr_level_up_card('00000000-0000-0000-0000-0000000000ff', 'archer', 1, 0, 0)$$,
                       'not_found', 'unknown player: rr:not_found');

do $$
begin
  perform tests.ok(
    (select level = 2 and copies = 5 from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'archer'),
    'failed level-ups (incl. not_enough_gold) leave level and copies unchanged');
  perform tests.eq((select gold from public.profiles where id = '00000000-0000-0000-0000-000000000081'), 900,
                   'failed level-ups leave the gold unchanged');
  perform tests.ok(
    (select level = 1 and copies = 1 from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'knight'),
    'knight is unchanged after not_enough_copies');
  perform tests.ok(
    (select level = 1 and copies = 7 from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000082' and card_id = 'musketeer'),
    'the musketeer of L is untouched');
end;
$$;

-- =============================================================================
-- rr_unlock_upgrade (archer is level 2, K has 900 gold)
-- =============================================================================
do $$
declare
  r record;
begin
  select * into r from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 0, 2, 200);
  perform tests.ok(r.unlocked_upgrades = 1 and r.gold = 700,
                   format('upgrade 1 returns mask 1 and 700 gold (got %s)', r));
  -- Bit 2 next to bit 0: the mask is combined, not overwritten.
  select * into r from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 2, 1, 0);
  perform tests.ok(r.unlocked_upgrades = 5 and r.gold = 700,
                   format('upgrade 3 for 0 gold adds bit 2: mask 5 (got %s)', r));
  perform tests.eq(
    (select unlocked_upgrades from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'archer'),
    5, 'the upgrade mask is stored on the card');
end;
$$;

select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 0, 2, 200)$$,
                       'upgrade_already_unlocked', 'the same upgrade twice: rr:upgrade_already_unlocked');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 1, 3, 600)$$,
                       'level_too_low', 'upgrade 2 needs level 3, archer has 2: rr:level_too_low');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 1, 2, 5000)$$,
                       'not_enough_gold', 'upgrade for 5000 gold with 700: rr:not_enough_gold');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'dragon', 0, 1, 0)$$,
                       'card_not_owned', 'upgrade of an unknown card: rr:card_not_owned');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'musketeer', 0, 1, 0)$$,
                       'card_not_owned', 'upgrade of a card only L owns: rr:card_not_owned');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 3, 1, 0)$$,
                       'bad_request', 'upgrade index 3: rr:bad_request');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', -1, 1, 0)$$,
                       'bad_request', 'upgrade index -1: rr:bad_request');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 1, -2, 0)$$,
                       'bad_request', 'negative minimum level: rr:bad_request');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 1, 6, 0)$$,
                       'bad_request', 'minimum level 6: rr:bad_request');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000081', 'archer', 1, 1, -5)$$,
                       'bad_request', 'negative gold: rr:bad_request');
select tests.throws_rr($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-0000000000ff', 'archer', 1, 1, 0)$$,
                       'not_found', 'unknown player: rr:not_found');

do $$
begin
  perform tests.eq(
    (select unlocked_upgrades from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'archer'),
    5, 'failed unlocks leave the mask unchanged');
  perform tests.eq((select gold from public.profiles where id = '00000000-0000-0000-0000-000000000081'), 700,
                   'failed unlocks leave the gold unchanged');
end;
$$;

-- =============================================================================
-- rr_spend_jokers (K has 5 jokers; bat has 1 copy; K does not own musketeer)
-- =============================================================================
do $$
declare
  r record;
begin
  select * into r from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'bat', 2, 2);
  perform tests.ok(r.copies = 3 and r.jokers = 3 and not r.card_unlocked,
                   format('2 jokers -> 2 bat copies: 3 copies, 3 jokers, not new (got %s)', r));

  select * into r from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'musketeer', 1, 2);
  perform tests.ok(r.copies = 1 and r.jokers = 1 and r.card_unlocked,
                   format('2 jokers -> new musketeer: 1 copy, 1 joker, unlocked (got %s)', r));
  perform tests.ok(
    (select level = 1 and copies = 1 and unlocked_upgrades = 0 from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'musketeer'),
    'the new card is stored at level 1 without upgrades');
  perform tests.eq((select jokers from public.profiles where id = '00000000-0000-0000-0000-000000000081'), 1,
                   'jokers are taken from the profile');
end;
$$;

select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'bat', 1, 2)$$,
                       'not_enough_jokers', '2 jokers with 1: rr:not_enough_jokers');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'dragon', 1, 2)$$,
                       'not_enough_jokers', 'not_enough_jokers also for a new card');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'bat', 0, 1)$$,
                       'bad_request', '0 copies: rr:bad_request');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'bat', 1, 0)$$,
                       'bad_request', '0 jokers: rr:bad_request');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'bat', -1, 1)$$,
                       'bad_request', 'negative copies: rr:bad_request');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'bat', 1, -1)$$,
                       'bad_request', 'negative jokers: rr:bad_request');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', 'Dragon!', 1, 1)$$,
                       'bad_request', 'invalid card id (table check): rr:bad_request');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000081', null, 1, 1)$$,
                       'bad_request', 'NULL card: rr:bad_request');
select tests.throws_rr($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-0000000000ff', 'bat', 1, 1)$$,
                       'not_found', 'unknown player: rr:not_found');

do $$
begin
  perform tests.eq((select jokers from public.profiles where id = '00000000-0000-0000-0000-000000000081'), 1,
                   'failed joker calls leave the jokers unchanged');
  perform tests.eq(
    (select copies from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id = 'bat'),
    3, 'failed joker calls leave the copies unchanged');
  perform tests.eq(
    (select count(*) from public.player_cards
      where user_id = '00000000-0000-0000-0000-000000000081' and card_id in ('dragon', 'Dragon!')),
    0::bigint, 'failed joker calls unlock no card');
  perform tests.ok(
    (select jokers = 0 from public.profiles where id = '00000000-0000-0000-0000-000000000082')
    and (select copies = 7 from public.player_cards
          where user_id = '00000000-0000-0000-0000-000000000082' and card_id = 'musketeer'),
    'joker calls of K did not touch L');
end;
$$;

reset role;
