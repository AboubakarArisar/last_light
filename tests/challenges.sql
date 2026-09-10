-- Run only against an EMPTY LOCAL test database: psql -v ON_ERROR_STOP=1 -f tests/challenges.sql
create schema auth;
create role anon;
create role authenticated;
create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
\ir ../supabase/migrations/202609100002_challenges.sql
\ir ../supabase/migrations/202609100003_challenge_access.sql
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','{"username":"Alice"}'),
 ('00000000-0000-0000-0000-000000000002','{"username":"Bob"}'),
 ('00000000-0000-0000-0000-000000000003','{"username":"Third"}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.friend_challenge('create','10000000-0000-0000-0000-000000000001',0,1407,66);
do $$ begin
 begin
  perform public.friend_challenge('accept','10000000-0000-0000-0000-000000000001');
  raise exception 'TEST: creator accepted own challenge';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare c jsonb; begin
 c := public.friend_challenge('view','10000000-0000-0000-0000-000000000001');
 if c ? 'creator_id' then raise exception 'Invitation leaked account ID'; end if;
 if (select count(*) from public.friend_challenges)<>0 then raise exception 'RLS leaked pending challenge'; end if;
end $$;
select public.friend_challenge('accept','10000000-0000-0000-0000-000000000001');
select public.friend_challenge('start','10000000-0000-0000-0000-000000000001');
do $$ begin
 begin
  perform public.friend_challenge('start','10000000-0000-0000-0000-000000000001');
  raise exception 'TEST: second start allowed';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
select public.friend_challenge('finish','10000000-0000-0000-0000-000000000001',p_score=>71);
select public.friend_challenge('finish','10000000-0000-0000-0000-000000000001',p_score=>99);
do $$ begin
 if (select result from public.friend_challenges)<>71 then raise exception 'Result overwritten'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 if (select result from public.friend_challenges)<>71 then raise exception 'Creator cannot see result'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ declare action text; begin
 if (select count(*) from public.friend_challenges)<>0 then raise exception 'RLS leaked history'; end if;
 foreach action in array array[null,'','unknown','view','accept','start','finish'] loop
  begin
   perform public.friend_challenge(action,'10000000-0000-0000-0000-000000000001',p_score=>100);
   raise exception 'TEST: third party access allowed';
  exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
 begin
  perform public.friend_challenge('view','10000000-0000-0000-0000-000000000001');
  raise exception 'TEST: signed-out access allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Challenge database checks passed' as result;
