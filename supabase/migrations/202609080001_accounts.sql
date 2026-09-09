-- Run once in the Supabase SQL editor, or apply with `supabase db push`.
begin;

create function public.valid_game_save(value jsonb) returns boolean
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
  return true;
end;
$$;

create table public.player_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (public.valid_game_save(data)),
  updated_at timestamptz not null default now()
);
create table public.save_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.player_saves enable row level security;
alter table public.save_operations enable row level security;
revoke all on public.player_saves, public.save_operations from anon, authenticated;
grant select on public.player_saves to authenticated;
create policy "Read own progress" on public.player_saves for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.sync_game_save(p_operation uuid, p_base jsonb, p_save jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); result jsonb; field text; section text; merged jsonb;
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
  update public.player_saves set data = result, updated_at = now() where user_id = uid;
  insert into public.save_operations(user_id, operation_id) values(uid, p_operation);
  return result;
end;
$$;
revoke all on function public.sync_game_save(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.sync_game_save(uuid,jsonb,jsonb) to authenticated;

-- Only the recovery Edge Function may access ticket hashes and rate limits.
create table public.recovery_tickets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ticket_hash text unique not null check (ticket_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create table public.recovery_limits (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.recovery_tickets enable row level security;
alter table public.recovery_limits enable row level security;
revoke all on public.recovery_tickets, public.recovery_limits from anon, authenticated;
grant all on public.recovery_tickets, public.recovery_limits to service_role;

create function public.allow_recovery(p_bucket text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare count integer;
begin
  delete from public.recovery_limits where window_start < now() - interval '1 day';
  insert into public.recovery_limits(bucket, window_start, attempts) values(p_bucket, now(), 1)
  on conflict (bucket) do update set
    attempts = case when public.recovery_limits.window_start < now() - interval '10 minutes' then 1 else public.recovery_limits.attempts + 1 end,
    window_start = case when public.recovery_limits.window_start < now() - interval '10 minutes' then now() else public.recovery_limits.window_start end
  returning attempts into count;
  return count <= 10;
end;
$$;

create function public.claim_recovery(p_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  delete from public.recovery_tickets where ticket_hash = p_hash returning user_id into uid;
  return uid;
end;
$$;
revoke all on function public.allow_recovery(text), public.claim_recovery(text) from public, anon, authenticated;
grant execute on function public.allow_recovery(text), public.claim_recovery(text) to service_role;

commit;
