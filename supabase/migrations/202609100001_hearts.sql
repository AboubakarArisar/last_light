-- V3: account-owned heart segments; three minutes per segment.
begin;
create or replace function public.valid_game_save(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare field text; item jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'object' or value->>'version' is distinct from '1'
    or octet_length(value::text) > 32768 then return false; end if;
  foreach field in array array['stars','best'] loop
    if jsonb_typeof(value->field) is distinct from 'array' then return false; end if;
    if jsonb_array_length(value->field) <> 64 then return false; end if;
    for item in select * from jsonb_array_elements(value->field) loop
      if jsonb_typeof(item) <> 'number' then return false; end if;
      if item::numeric < 0 or item::numeric > (case when field = 'stars' then 3 else 100 end)
        or trunc(item::numeric) <> item::numeric then return false; end if;
    end loop;
  end loop;
  foreach field in array array['stats','profile','settings','daily'] loop
    if jsonb_typeof(value->field) is distinct from 'object' then return false; end if;
  end loop;
  foreach field in array array['goals','shots','passes','completedPasses','attempts','curved','headers','volleys','freeKicks','longest'] loop
    if jsonb_typeof(value->'stats'->field) is distinct from 'number' then return false; end if;
    if (value->'stats'->>field)::numeric < 0 or (value->'stats'->>field)::numeric > 1e12 then return false; end if;
  end loop;
  foreach field in array array['name','skin','kit','boots','hair','celebration'] loop
    if jsonb_typeof(value->'profile'->field) is distinct from 'string'
      or length(value->'profile'->>field) > 24 then return false; end if;
  end loop;
  if jsonb_typeof(value->'profile'->'number') is distinct from 'number'
    or (value->'profile'->>'number')::numeric not between 1 and 99 then return false; end if;
  foreach field in array array['skin','kit','boots'] loop
    if value->'profile'->>field !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
  end loop;
  foreach field in array array['volume','music','crowd'] loop
    if jsonb_typeof(value->'settings'->field) is distinct from 'number' then return false; end if;
    if (value->'settings'->>field)::numeric not between 0 and 1 then return false; end if;
  end loop;
  foreach field in array array['vibration','reducedMotion'] loop
    if jsonb_typeof(value->'settings'->field) is distinct from 'boolean' then return false; end if;
  end loop;
  if coalesce(value->'settings'->>'graphics','') not in ('auto','low','medium','high') then return false; end if;
  if jsonb_typeof(value->'daily'->'date') is distinct from 'string'
    or value->'daily'->>'date' !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' then return false; end if;
  foreach field in array array['stars','best','streak'] loop
    if jsonb_typeof(value->'daily'->field) is distinct from 'number' then return false; end if;
    if (value->'daily'->>field)::numeric not between 0 and
      (case field when 'stars' then 3 when 'best' then 100 else 99999 end) then return false; end if;
  end loop;
  if value ? 'hearts' then
    if jsonb_typeof(value->'hearts') is distinct from 'object' then return false; end if;
    foreach field in array array['spent','fullAt'] loop
      if jsonb_typeof(value->'hearts'->field) is distinct from 'number' then return false; end if;
      if (value->'hearts'->>field)::numeric not between 0 and 9007199254740991
        or trunc((value->'hearts'->>field)::numeric) <> (value->'hearts'->>field)::numeric then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

create or replace function public.sync_game_save_v3(p_operation uuid, p_base jsonb, p_save jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); result jsonb; field text; section text; merged jsonb; heart_delta numeric; full_at numeric;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_operation is null or not public.valid_game_save(p_base) or not public.valid_game_save(p_save)
    then raise exception 'Invalid save' using errcode = '22023'; end if;
  insert into public.player_saves(user_id, data) values(uid, p_base) on conflict do nothing;
  select data into result from public.player_saves where user_id = uid for update;
  -- Serialize writes and remember operation IDs so lost responses can be retried safely.
  if exists(select 1 from public.save_operations where user_id = uid and operation_id = p_operation)
    then return result; end if;
  foreach field in array array['stars','best'] loop
    select jsonb_agg(greatest((result->field->i)::numeric, (p_save->field->i)::numeric) order by i)
      into merged from generate_series(0,63) as i;
    result := jsonb_set(result, array[field], merged);
  end loop;
  foreach field in array array['goals','shots','passes','completedPasses','attempts','curved','headers','volleys','freeKicks','longest'] loop
    result := jsonb_set(result, array['stats',field], to_jsonb(
      case when field = 'longest' then greatest((result->'stats'->>field)::numeric, (p_save->'stats'->>field)::numeric)
      else (result->'stats'->>field)::numeric + greatest(0, (p_save->'stats'->>field)::numeric - (p_base->'stats'->>field)::numeric) end));
  end loop;
  foreach section in array array['profile','settings'] loop
    for field in select jsonb_object_keys(p_save->section) loop
      if p_save->section->field is distinct from p_base->section->field
        then result := jsonb_set(result, array[section,field], p_save->section->field); end if;
    end loop;
  end loop;
  if p_save->'daily'->>'date' > result->'daily'->>'date' then
    result := jsonb_set(result, '{daily}', p_save->'daily');
  elsif p_save->'daily'->>'date' = result->'daily'->>'date' then
    foreach field in array array['stars','best','streak'] loop
      result := jsonb_set(result, array['daily',field], to_jsonb(greatest(
        (result->'daily'->>field)::numeric, (p_save->'daily'->>field)::numeric)));
    end loop;
  end if;
  heart_delta := greatest(0, coalesce((p_save->'hearts'->>'spent')::numeric,0) - coalesce((p_base->'hearts'->>'spent')::numeric,0));
  full_at := coalesce((result->'hearts'->>'fullAt')::numeric,0);
  if heart_delta > 0 then
    full_at := greatest(full_at, coalesce((p_save->'hearts'->>'fullAt')::numeric,0) - heart_delta * 180000) + heart_delta * 180000;
    full_at := least(full_at, floor(extract(epoch from clock_timestamp()) * 1000) + 25 * 180000);
  end if;
  result := jsonb_set(result, '{hearts}', jsonb_build_object(
    'spent', coalesce((result->'hearts'->>'spent')::numeric,0) + heart_delta,
    'fullAt', full_at));
  update public.player_saves set data = result, updated_at = now() where user_id = uid;
  insert into public.save_operations(user_id, operation_id) values(uid, p_operation);
  return result;
end;
$$;
revoke all on function public.sync_game_save_v3(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.sync_game_save_v3(uuid,jsonb,jsonb) to authenticated;


commit;

