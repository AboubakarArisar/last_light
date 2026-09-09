# Validation record

Validated on 7 September 2026 (Asia/Karachi), using Node 24 and the Codex Chromium browser.

## Automated checks

`npm test`: **14 tests passed**. Coverage includes:

- 64 reproducible scenarios, eight chapters and 16 football situation templates.
- A complete scoring route for **every scenario**, including all required pass phases.
- Seeded daily challenges and validated challenge URL round trips.
- Corrupt/partial save recovery, monotonic awards, chapter progression and daily streaks.
- Pass reception, goals, interceptions, keeper saves, wide shots and objective failures.
- Post-and-in goals, recoverable post rebounds and kicking again after recovery.
- Spin, gravity, bounce, friction and bounded execution duration.
- Identical replay samples for identical commands; interpolation and net containment.
- Primary-pointer capture, tiny/accidental stroke rejection, secondary-pointer rejection and cancellation.

`npm run build`: TypeScript checking and Vite production build passed without warnings. Runtime JavaScript is approximately **152 KB gzip**, plus **5.6 KB gzip CSS**. Font files are hosted locally. Asset licenses are included.

## Browser playtesting

| Check | Observed result |
| --- | --- |
| Opening moment, desktop | Pass → shot → three-star result |
| Second career moment, portrait 390 × 844 | Pass → shot → three-star result; career advanced |
| Persistence after reload | Two completed career moments and six stars retained |
| Corner challenge, portrait | Ball visible at corner; lifted delivery created aerial decision |
| Final, desktop 1280 × 720 | Interception and immediate retry; two successful lofted passes followed by a three-star header |
| Replay | Complete attack rendered; pause, seek-to-end, half speed and exit worked |
| Production Daily Shot | Corner → header → three stars; best quality 67 and one-day streak saved |
| Challenge sharing | Exact scenario/seed URL shown and copied successfully |
| Player identity | Name, shirt number and unlocked boots saved |
| Settings | Graphics and reduced-motion values changed successfully |
| Career UI | 64 scenario entries; only earned career unlocks available; daily/friend play did not unlock career |
| Console | Fresh production tab reported no warnings or errors |

## Performance and visual inspection

Inspected home, gameplay, results, career, Daily Shot, customization, settings and replay. Checked desktop and portrait layouts. Fixed opening-ball clipping, wide-corner framing, mobile navigation, heading overflow, and shared-link feedback.

Observed 60 FPS in the earlier mobile-viewport scene; the crowded final measured approximately 30–35 FPS in the browser test environment. Do **not** interpret responsive emulation as a physical mobile benchmark. Player instancing reduced the final's draw calls from **394 to 177** and triangles from **1.42 million to 0.67 million**, preserving articulated animation. Initial development rendering measured **1.8–2.3 seconds** after navigation in the test environment; this is not a public-network cold-load guarantee.

## Release checks outside this environment

- Physical iOS/Safari and Android/Chrome touch, thermal behavior and GPU performance.
- Native operating-system Web Share sheet and physical vibration. The copy/select-URL path was verified.
- Listening review on speakers/headphones; browser audio actions ran without console errors, but no audio recording was captured for independent review.
- Extended human difficulty balancing across all 64 moments. Automated solvability and representative early/middle/final browser playtesting are complete; every scenario has not received a human playthrough.

No public deployment was performed. Serve `dist/` over HTTPS for release.

## V3 hearts — 10 September 2026

- Five hearts, five segments each; one segment regenerates every three minutes from the first deduction. Later deductions retain the existing countdown.
- Added heart/account tests covering exhaustion, elapsed recovery, legacy saves, concurrent deductions, lost-response retries, independent users, guest import exclusion, and success versus abandonment.
- Applied both migrations to an isolated password-protected local PostgreSQL instance. `tests/hearts.sql` passed: legacy validation, heart persistence, concurrent updates, idempotency, RLS between two users, and unauthenticated rejection. Test writes rolled back and the instance was stopped.
- Browser guest testing on a separate localhost origin verified free pre-kick retries, one-segment failure/abandonment deductions, a 3:00 countdown, persistence after reload, actual automatic refill, zero-heart career blocking, and free Daily Shot retries at zero. Inspected mobile 390 × 844 layout and restored the viewport afterward.
- Live Supabase migration and cross-device production testing remain deployment steps; the V3 SQL migration is prepared but was not applied to the hosted project.
