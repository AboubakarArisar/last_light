# Supabase account setup

## Already added `.env.local`? Finish these two steps

Environment variables connect the app to Supabase Auth. They do **not** install the save database or recovery function.

1. In your Supabase project, open **SQL Editor → New query**. Paste the complete contents of [the migration](migrations/202609080001_accounts.sql) and click **Run** once. This enables cloud saves and installs the recovery tables.
2. In a terminal at the root of this game, run the commands below. Replace `YOUR_PROJECT_REF` with the first part of your Supabase URL: `https://YOUR_PROJECT_REF.supabase.co`.

```sh
npx supabase login
npx supabase secrets set ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173" --project-ref YOUR_PROJECT_REF
npx supabase functions deploy recovery-ticket --project-ref YOUR_PROJECT_REF
```

For a hosted game, add its exact origin to `ALLOWED_ORIGINS` too. Then return to **Account → Check saved progress** and retry preparing the recovery code. You do not need to create another account.

## 1. Project and authentication

Create a Supabase project. Under **Authentication → Sign In / Providers → Email**, enable email/password signup and **disable Confirm email**. Set the minimum password length to **10** in password security settings. Leave MFA disabled. Login uses email; username is a display name and is not required to be unique.

Supabase Auth hashes passwords with bcrypt. The game does not hash passwords in JavaScript or store passwords in its save tables. Do not create a separate password column.

Run `migrations/202609080001_accounts.sql` in the project's SQL editor. It creates private progress tables, an authenticated sync function, and recovery-ticket tables accessible only to the server. Apply this migration once. Alternatively, link the Supabase CLI to your project and run `supabase db push`.

## 2. Browser environment

Copy the root `.env.example` to `.env.local` and fill in the project URL and **publishable** key from the project API settings:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Restart Vite after adding the variables. For hosting, set these two build-time variables and rebuild. Never put a secret or service-role key into any `VITE_` variable. Environment files are gitignored.

Without these variables the game remains playable as a guest and shows that accounts are unavailable.

## 3. Deploy no-email recovery

Install/login to the Supabase CLI, link your project, and run from this repository:

```sh
supabase secrets set ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173,https://YOUR_GAME_DOMAIN"
supabase functions deploy recovery-ticket
```

Replace the example domain with your actual origin (scheme, host and optional port; no trailing slash). Only list origins you control. The function refuses browser requests from other origins. Its Supabase URL and service-role key are supplied by the hosted Edge Function environment; do not add those secrets to the browser.

The function's gateway JWT check is disabled in `config.toml` because forgotten-password recovery starts signed out. **Issuing a ticket verifies the signed-in user's JWT server-side.** Resetting a password requires the full 192-bit random ticket. Neither action accepts a user ID supplied by the caller. Recovery does not send email, request an OTP, or use guessable security questions.

Signup immediately signs the user in, then opens a dedicated second step that automatically prepares a recovery code. Users can copy or download it and confirm they saved it before continuing. If recovery is unavailable, this step explains that the account was created, offers retry, and allows finishing later without repeating signup. A new ticket invalidates the previous ticket; a successful reset consumes it. Tickets are shown in memory, never saved in browser storage automatically. Users must keep their downloaded/copied ticket somewhere private and generate a new one after recovery.

The server stores only SHA-256 hashes of high-entropy tickets. Concurrent redemption is prevented by atomic consumption. Password updates use the Supabase Auth admin API, never direct writes to `auth.users`. A definite rejected password update restores the ticket; an uncertain server/network outcome leaves it consumed to prevent replay. If a reset response is interrupted, first try signing in with the new password. Without the password or a valid ticket, there is no self-service recovery; the project owner must handle verified support cases.

## Saves and offline behavior

- Signed-in players have a separate browser cache per account and private cloud progress.
- Browsers with Web Locks allow one active game tab per account to prevent conflicting writes to that browser's cache. Other devices still sync independently.
- Cloud availability does not block gameplay. On a new signed-in device, Daily Shot and friend challenges remain available while the cloud is unavailable; career waits for the first successful account load to avoid granting an unknown heart balance; returning devices use their existing account cache. When connected, local results merge into the cloud save without removing completed levels.
- Local changes are queued before upload. A server-side operation ID makes retries idempotent, including when a response is lost after a successful write.
- Cloud merges retain the best stars/scores and add only new statistical increments. Profile/settings changes are merged field by field.
- Guest progress is imported explicitly from Account, once per browser. The original guest save is retained as a backup. Logging out returns to the separate guest save.
- A failed cloud read cannot replace cloud progress with a fresh save. Unreadable caches are preserved and reported. Browser storage must be writable to durably queue cloud updates.
- Reset guest progress affects only the guest save. There is no destructive cloud-reset action.
- Existing progress already erased from browser storage cannot be reconstructed by this integration.

## Verify against your project

1. Sign up with username, email and a password. Confirm immediate login and copy the ticket.
2. Complete a level, wait for **Progress saved to your account**, log out, log back in, and verify the level and statistics.
3. Sign in on another browser/device and verify the same progress. A second account must see only its own progress.
4. Disconnect the network, play using an existing cache, reconnect, and verify that queued progress syncs once.
5. Log out, use **Forgot password?** with the ticket and a new password, then log in. The old password and used ticket must fail. Generate a replacement ticket.
6. Try a malformed ticket and an unauthenticated ticket-creation request; both must fail. Confirm that anonymous requests and another user's JWT cannot read a player's save or any recovery hashes.

Local tests use mocked auth/network boundaries; only this live-project checklist verifies your project's authentication settings and deployed function end to end.

Run the frontend tests with `npm test`, build/type-check with `npm run build`, and test the recovery handler without a live network using `deno test --allow-env tests/recovery.edge.ts`.

## V3 migration

After the accounts migration, apply [the hearts migration](migrations/202609100001_hearts.sql) before releasing V3. It preserves existing saves and RLS, validates optional legacy-compatible heart data, and adds `sync_game_save_v3`. Heart deductions merge as unacknowledged increments under the existing per-user row lock and operation ID. Guest imports explicitly exclude hearts. No global heart balance or timer is stored.
