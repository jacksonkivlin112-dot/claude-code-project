# sim-shorts

Generates satisfying physics-simulation YouTube Shorts: 1080×1920, 60 fps, under a minute, with generated sound. Every video is different (seeded), and nothing in it needs a license: the visuals, sounds and font (Inter, OFL) are all original or open.

## Formats

| Format | What happens | Hook |
| --- | --- | --- |
| `escape` | A ball bounces inside 7–12 spinning rings, each with a gap. Every bounce plays the next note; slipping through a gap shatters the ring. | "Can the ball escape all N rings?" Guess the time in the comments |
| `colors` | 2–4 colored balls each flip the squares they hit to their own color. The board swings back and forth for 52 seconds. | "Which color wins?" Pick a color in the comments |
| `race` | 4–6 marbles race down a randomly built course of pegs, zigzag ramps, funnels, stairs and bumpers. The camera follows the leader, with live standings at the top. | "Which marble wins?" Pick a marble in the comments |
| `battle` | Two fighter balls with different powers (Spike, Dash, Giant, Vampire, Tank) bounce around an arena. Every hit deals damage and grows the attacker's power; charging in hits harder. Health bars, floating damage numbers and a KO finish. | "Who wins?" Pick a side in the comments |

Before rendering, each video is simulated ahead to pick the most watchable version of its seed: escapes are tuned to finish around 34–54 seconds, color battles favor close, back-and-forth finishes, marble races are built so the winner crosses at 38–52 seconds with plenty of lead changes, and ball battles are balanced to end at 36–52 seconds with a close but clear winner.

Every video carries a series label at the top ("RING ESCAPE #14", "COLOR BATTLE #3", "MARBLE RACE #7", "BALL BATTLE #2"). Episode numbers continue automatically from `out/series.json`, and the first title idea includes the episode.

## Make videos

Needs Node 18+ and ffmpeg.

```sh
cd sim-shorts
npm ci
node src/cli.js                            # one random video
node src/cli.js --format escape --count 5  # five ring escapes
node src/cli.js --format colors --seed 42  # same seed = same video
node src/cli.js --count 10 --out out/week1 # a batch, alternating formats
node src/cli.js --format race --series "Marble Mayhem" --episode 20   # your own series name and numbering
node src/cli.js --series none               # no series label
```

Each video is written as `out/<format>-<seed>.mp4` with a `.json` next to it holding title ideas, a description and tags. Every run also writes `upload-list.md` in the output folder: a copy-and-paste sheet with the title, description, tags and a suggested pinned comment for each video. Rebuild it for any folder with `node src/sheet.js out/week1`.

## Uploading

- Post one or two a day at a consistent time. Use one of the titles from the `.json`.
- Pin a comment that asks the question ("What time did you guess?", "Which color did you pick?"). Comments are what push Shorts.
- Add your own touch to keep the channel monetizable. YouTube doesn't pay channels that only post near-identical auto-made videos. A custom intro line, a series name ("Ring Escape #14"), or your own voice reacting all help.
