# sim-shorts

Generates satisfying physics-simulation YouTube Shorts: 1080×1920, 60 fps, under a minute, with generated sound. Every video is different (seeded), and nothing in it needs a license: the visuals, sounds and font (Inter, OFL) are all original or open.

## Formats

| Format | What happens | Hook |
| --- | --- | --- |
| `escape` | A ball bounces inside 7–12 spinning rings, each with a gap. Every bounce plays the next note; slipping through a gap shatters the ring. | "Can the ball escape all N rings?" Guess the time in the comments |
| `colors` | 2–4 colored balls each flip the squares they hit to their own color. The board swings back and forth for 52 seconds. | "Which color wins?" Pick a color in the comments |

Before rendering, each video is simulated ahead to pick the most watchable version of its seed: escapes are tuned to finish around 34–54 seconds, and color battles favor close, back-and-forth finishes.

## Make videos

Needs Node 18+ and ffmpeg.

```sh
cd sim-shorts
npm ci
node src/cli.js                            # one random video
node src/cli.js --format escape --count 5  # five ring escapes
node src/cli.js --format colors --seed 42  # same seed = same video
node src/cli.js --count 10 --out out/week1 # a batch, alternating formats
```

Each video is written as `out/<format>-<seed>.mp4` with a `.json` next to it holding title ideas, a description and tags.

## Uploading

- Post one or two a day at a consistent time. Use one of the titles from the `.json`.
- Pin a comment that asks the question ("What time did you guess?", "Which color did you pick?"). Comments are what push Shorts.
- Add your own touch to keep the channel monetizable. YouTube doesn't pay channels that only post near-identical auto-made videos. A custom intro line, a series name ("Ring Escape #14"), or your own voice reacting all help.
