import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeStanding, validChallengeId, challengeError, type FriendChallenge } from '../src/challenges.ts';
test('both players see opposite outcomes, including misses and draws', () => {
 const c: FriendChallenge = { id: '10000000-0000-0000-0000-000000000001', creator_id: 'a', opponent_id: 'b', creator_name: 'Alice', level_id: 0, seed: 1407, target: 66 };
 assert.equal(challengeStanding(c,'a'),'Running');
 assert.equal(challengeStanding({...c,opponent_id:null},'a'),'Waiting for a friend');
 for (const [score,a,b] of [[71,'Lost','Won'],[60,'Won','Lost'],[-1,'Won','Lost'],[66,'Draw','Draw']] as const) {
  const result={...c,result:score,completed_at:'2026-09-10'};
  assert.equal(challengeStanding(result,'a'),a); assert.equal(challengeStanding(result,'b'),b);
 }
 assert.equal(validChallengeId(c.id),true);
 for (const bad of [null,'0.1407','<script>','123']) assert.equal(validChallengeId(bad),false);
});

test('unexpected backend details never reach the interface', () => {
 assert.equal(challengeError({code:'XX000',message:'private database details'}),'Could not reach challenges. Please try again.');
 assert.equal(challengeError({code:'42501',message:'private row details'}),'This challenge is unavailable to your account. Check the invitation and sign-in.');
 assert.equal(challengeError({message:'This challenge already has two players'}),'This challenge already has two players');
});
