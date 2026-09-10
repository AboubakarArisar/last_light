export interface FriendChallenge {
 id: string; creator_id?: string; opponent_id?: string | null;
 creator_name: string; opponent_name?: string | null;
 level_id: number; seed: number; target: number; result?: number | null;
 started_at?: string | null; completed_at?: string | null; created_at?: string;
}
export function validChallengeId(value: string | null): value is string {
 return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function challengeStanding(c: FriendChallenge, user: string) {
 if (!c.completed_at) return c.opponent_id ? 'Running' : 'Waiting for a friend';
 if (c.result === c.target) return 'Draw';
 const opponentWon = c.result !== null && c.result !== undefined && c.result > c.target;
 return (user === c.opponent_id ? opponentWon : !opponentWon) ? 'Won' : 'Lost';
}

// Keep database internals and unexpected backend messages out of the interface.
export function challengeError(error: { code?: string; message?: string }) {
 if (["PGRST202", "PGRST205", "42P01"].includes(error.code ?? ""))
  return "Challenges are not available yet. Please try again later.";
 const publicMessages = ["You cannot accept your own challenge", "This challenge already has two players",
  "This attempt has already started. Open its overview.", "Only the opponent can play", "No active attempt"];
 if (publicMessages.includes(error.message ?? "")) return error.message!;
 if (error.code === "42501" || error.message === "Challenge not found")
  return "This challenge is unavailable to your account. Check the invitation and sign-in.";
 return "Could not reach challenges. Please try again.";
}
