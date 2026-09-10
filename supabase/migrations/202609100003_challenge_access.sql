-- Apply after the challenge migration, including on existing installations.
begin;
create or replace function public.friend_challenge(p_action text, p_id uuid, p_level integer default null,
 p_seed bigint default null, p_score integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c public.friend_challenges; player_name text;
begin
 if p_action is null or p_action not in ('create','view','accept','start','finish') then raise exception 'Invalid action' using errcode='22023'; end if;
 if uid is null then raise exception 'Sign in to use challenges' using errcode='42501'; end if;
 select left(coalesce(nullif(raw_user_meta_data->>'username',''),'Player'),24)
 into player_name from auth.users where id=uid;
 if p_action='create' then
  if p_id is null or p_level is null or p_level not between 0 and 63 or p_seed is null
   or p_seed not between 0 and 4294967295 or p_score is null or p_score not between 0 and 100
   then raise exception 'Invalid challenge'; end if;
  insert into public.friend_challenges(id,creator_id,creator_name,level_id,seed,target)
   values(p_id,uid,player_name,p_level,p_seed,p_score) on conflict(id) do nothing;
 end if;
 select * into c from public.friend_challenges where id=p_id for update;
 if not found then raise exception 'Challenge not found'; end if;
 if p_action='accept' then
  if c.creator_id=uid then raise exception 'You cannot accept your own challenge'; end if;
  if c.opponent_id is not null and c.opponent_id<>uid then raise exception 'This challenge already has two players'; end if;
  update public.friend_challenges set opponent_id=uid,opponent_name=player_name where id=p_id and opponent_id is null;
 elsif p_action='start' then
  if c.opponent_id is distinct from uid then raise exception 'Only the opponent can play'; end if;
  if c.started_at is not null or c.completed_at is not null then raise exception 'This attempt has already started. Open its overview.'; end if;
  update public.friend_challenges set started_at=now() where id=p_id;
 elsif p_action='finish' then
  if c.opponent_id is distinct from uid or c.started_at is null then raise exception 'No active attempt'; end if;
  if p_score is null or p_score not between -1 and 100 then raise exception 'Invalid result'; end if;
  update public.friend_challenges set result=p_score,completed_at=now() where id=p_id and completed_at is null;
 elsif p_action not in ('create','view') then raise exception 'Unknown action';
 end if;
 select * into c from public.friend_challenges where id=p_id;
 if c.creator_id<>uid and c.opponent_id is distinct from uid then
  if p_action='view' and c.opponent_id is null then
   -- An unclaimed invitation exposes only the game and inviter, never account IDs.
   return jsonb_build_object('id',c.id,'creator_name',c.creator_name,'level_id',c.level_id,'seed',c.seed,'target',c.target);
  end if;
  raise exception 'This challenge is private' using errcode='42501';
 end if;
 select * into c from public.friend_challenges where id=p_id;
 return to_jsonb(c);
end;
$$;
commit;
