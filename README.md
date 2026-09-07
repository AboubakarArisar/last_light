# LAST LIGHT

An original browser football game about drawing a decisive attacking move. Built with TypeScript, Three.js and Vite. No account, backend, energy timer, or licensed football assets.

## Run

Requires Node.js 22.18+ (24 recommended).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm test
npm run build
npm run preview
```

Host the contents of `dist/` at a site's root. HTTPS enables clipboard sharing, Web Share and supported haptics. Set `Cache-Control: public, max-age=31536000, immutable` for hashed `/assets/` files and revalidate `index.html`. The runtime makes no external font, asset or API requests. Fonts are included locally.

## Play

- Draw from the ball to a teammate, or ahead of their run, to pass.
- Complete the number of passes shown in the moment, then draw into the goal.
- Curve the stroke for lateral spin. Draw faster for more power.
- Select **Lifted** for a chip or aerial delivery. The height of a received cross determines a header, volley or first touch.
- Retry at any time. A missed shot, interception or failed objective ends the attempt; a loose rebound can be recovered.
- Arrow keys position an aim target, Enter executes, L toggles lift, Escape pauses and R restarts. Touch and pen use the same Pointer Events path.

Career contains 64 seeded scenarios across eight chapters. Stars unlock cosmetic kits, boots and celebrations. Progress, profile, settings, daily results and football statistics are versioned in local storage. The daily challenge rolls over at midnight UTC. Friend URLs recreate a scenario and seed without changing career unlocks. Replays retain sampled simulation frames in memory for the current attempt.

## Structure

| Module | Responsibility |
| --- | --- |
| `src/levels.ts` | Career templates, routes, difficulty, daily seed and challenge validation |
| `src/simulation.ts` | Fixed 120 Hz ball integration, launch solver, AI, collisions and outcome rules |
| `src/input.ts` | Pointer capture, stroke sampling, intent classification and keyboard aiming |
| `src/rendering.ts` | Full-scale stadium, procedural grass, articulated players, camera, crowd, net and weather |
| `src/replay.ts` | Binary search and interpolation of recorded frames |
| `src/audio.ts` | Original synthesized impacts, ambience, menu rhythm and sound lifecycle |
| `src/save.ts` | Corruption-tolerant save parsing, progression and daily streaks |
| `src/main.ts` | Application screens, event handling and session lifecycle |
| `src/strings.ts` | Shared interface vocabulary for future localization |
| `tests/` | Node tests and a deterministic route solver covering all 64 scenarios |

## Implementation choices and limits

Players and environments are original procedural geometry with articulated animation, not licensed motion-capture assets. Stadiums share reusable architecture with crowd density, lighting and atmosphere variations. Goal cloth and player contact use lightweight approximations; this is a focused attacking-moment game, not an eleven-a-side match simulation. AI, player collision volumes and goalkeeper reach are intentionally tuned for readable puzzle play.

Browser responsive testing is not a substitute for physical iOS/Android testing. There is no online leaderboard or multiplayer service. Web Share depends on browser support; clipboard or a selectable URL is the fallback. Local storage can be unavailable or cleared by the browser, in which case the game reports that progress cannot persist. Replays are for the current attempt and are not saved as video.

The test suite verifies rules and solvability; it does not establish that every scenario has received human playtesting. See `QA.md` for recorded validation and remaining release checks.
