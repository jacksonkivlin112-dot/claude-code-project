# clipper

Turns a long stream, podcast or interview into ready-to-post vertical Shorts: the stream on top, original block-parkour gameplay below, and big word-by-word captions on the split line.

1. **Transcribe** the audio with word timestamps ([faster-whisper](https://github.com/SYSTRAN/faster-whisper), runs locally) and measure loudness every half second.
2. **Pick the best moments.** Clips are built from whole sentences, 20–50 s long, scored on loudness spikes (hype), reaction words, punctuation, talking pace and dead air.
3. **Cut each one** to 1080×1920: stream on top (cropped around `--focus`), gameplay on the bottom, a hook headline for the first 3 s, captions with the current word highlighted, and audio normalized to −14 LUFS.
4. **Write `upload-list.md`** with titles, descriptions and the campaign checklist.

## Only clip creators who allow it

Clips of someone else's stream without permission get copyright claims, and three strikes deletes a channel. A gameplay split-screen does **not** prevent that; it's there for watch time. Join a creator's clipping campaign (Content Rewards on Whop, Vyro and others) and follow its rules: some campaigns don't allow split-screens or require certain tags.

## Setup

Needs Node 18+, ffmpeg and Python 3.

```sh
cd clipper
npm install
python3 -m venv .venv && .venv/bin/pip install faster-whisper==1.1.1 requests
npm run parkour -- --count 4 --seconds 90     # gameplay library in assets/parkour (one per theme)
```

## Make clips

```sh
node src/clip.js input/stream.mp4 --name speed-tour --creator "IShowSpeed" --count 6
```

| Option | Default | |
| --- | --- | --- |
| `--count N` | 5 | how many clips |
| `--min S` / `--max S` | 20 / 50 | clip length in seconds |
| `--focus F` | 0.5 | where to crop the stream horizontally (0 = left edge, 1 = right edge) |
| `--model M` | base.en | speech model; `small.en` is more accurate but slower |
| `--creator NAME` | | used in titles and hashtags |
| `--parkour DIR` | assets/parkour | gameplay folder for the bottom half; any videos work, including your own recordings |
| `--no-parkour` | | full-height stream instead of split screen |

Clips go to `out/<name>/clip-01.mp4…` with `clips.json` and `upload-list.md`. The transcript is cached, so re-running with different options is fast.

## Parkour gameplay

`src/parkour.js` renders an original first-person run across floating blocks (sky, sunset, neon and candy themes). Everything is generated, so the footage is yours to use anywhere.

```sh
node src/parkour.js --theme neon --seconds 120 --seed 7
```
