-- Run only in a disposable database after both migrations, with an auth.uid()
-- test stub reading request.jwt.claim.sub. All fixture writes are rolled back.
begin;
insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare base jsonb; local_save jsonb; result jsonb; first_result jsonb;
begin
  base := jsonb_build_object(
    'version',1, 'stars',to_jsonb(array_fill(0,array[64])), 'best',to_jsonb(array_fill(0,array[64])),
    'profile','{"name":"Test","number":10,"skin":"#ffffff","kit":"#ffffff","boots":"#ffffff","hair":"short","celebration":"arms"}'::jsonb,
    'settings','{"volume":0.5,"music":0.5,"crowd":0.5,"graphics":"low","vibration":false,"reducedMotion":false}'::jsonb,
    'stats','{"goals":0,"shots":0,"passes":0,"completedPasses":0,"attempts":0,"curved":0,"headers":0,"volleys":0,"freeKicks":0,"longest":0}'::jsonb,
    'daily','{"date":"","stars":0,"best":0,"streak":0}'::jsonb);
  assert public.valid_game_save(base), 'Legacy saves must remain valid';
  local_save := jsonb_set(base,'{hearts}','{"spent":1,"fullAt":1180000}'::jsonb);
  result := public.sync_game_save_v3('33333333-3333-4333-8333-333333333333',base,local_save);
  assert result->'hearts' = local_save->'hearts', 'First deduction must persist';
  first_result := result;
  result := public.sync_game_save_v3('33333333-3333-4333-8333-333333333333',base,local_save);
  assert result = first_result, 'Retry must be idempotent';
  result := public.sync_game_save_v3('44444444-4444-4444-8444-444444444444',base,local_save);
  assert result->'hearts' = '{"spent":2,"fullAt":1360000}'::jsonb, 'Concurrent deductions must merge';
  assert not public.valid_game_save(jsonb_set(base,'{hearts}','{"spent":-1,"fullAt":0}'::jsonb)), 'Negative hearts rejected';
  assert not public.valid_game_save(jsonb_set(base,'{hearts}','{"spent":1.5,"fullAt":0}'::jsonb)), 'Fractional hearts rejected';
  assert (select count(*) from public.player_saves) = 1, 'Alice sees own row';
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  assert (select count(*) from public.player_saves) = 0, 'Bob cannot read Alice';
  result := public.sync_game_save_v3('33333333-3333-4333-8333-333333333333',base,base);
  assert result->'hearts' = '{"spent":0,"fullAt":0}'::jsonb, 'Bob starts independently at full hearts';
  assert (select count(*) from public.player_saves) = 1, 'Bob sees only own row';
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.sync_game_save_v3('55555555-5555-4555-8555-555555555555',base,base);
    raise exception 'Unauthenticated call was accepted';
  exception when insufficient_privilege then
    raise notice 'Unauthenticated heart sync rejected';
  end;
end;
$$;
rollback;
