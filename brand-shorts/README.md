# brand-shorts

Makes original, voiced TikToks (or YouTube Shorts) for brand deals (Launchpoint and similar creator platforms) from a brief and the brand's product media.

Each video gets a hook headline, an AI voiceover, word-by-word captions, the product shown with motion, a numbered list or story structure, an always-on **"Paid partnership"** label, a progress bar, a quiet original music bed, and a branded end card with the call to action. Every variant rotates **hook, structure, selling points, voice and layout**, so videos for the same brand don't look duplicated (Launchpoint checks for duplicates before paying).

## Setup

Needs Node 18+, ffmpeg and Python 3.

```sh
cd brand-shorts
npm install
python3 -m venv .venv && .venv/bin/pip install piper-tts
# voices (only ones that allow commercial use):
for v in joe kristin norman; do for ext in onnx onnx.json; do
  curl -sSL -o voices/en_US-$v-medium.$ext "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/$v/medium/en_US-$v-medium.$ext"
done; done
```

Voice licenses: **joe** (CC0), **kristin** and **norman** (trained on public-domain LibriVox recordings); model cards are in `voices/`. Don't add Piper voices trained on non-commercial data (for example ryan, lessac or hfc_female): brand deals are commercial.

## Make videos

```sh
node src/make.js path/to/brief.json --count 4          # variants 1-4
node src/make.js path/to/brief.json --start 4 --count 4 # the next 4, different again
```

Videos go to `out/<brand>/` with `upload-list.md` (captions or titles, scripts and the posting checklist). Options: `--platform tiktok|youtube` (default tiktok), `--out DIR`, `--speed 1.08` (voice speed).

The layout keeps captions, the hook and the disclosure label out of each app's overlay. On TikTok that means the tabs at the top, the like/comment/share buttons down the right side, and the caption and sound name along the bottom.

## The brief

See `examples/quillo/brief.json` (a made-up demo brand; `npm run demo-media` draws its screenshots). Paths are relative to the brief file.

| Field | |
| --- | --- |
| `brand`, `product` | names used in the script and end card |
| `disclosure` | on-screen label, e.g. "Paid partnership with Brand" |
| `hashtags` | put `#ad` first |
| `colors.primary`, `colors.accent` | hook box / end card, and caption highlight / progress bar |
| `logo` | square image for the end card |
| `media` | product images: screenshots, product photos (images for now) |
| `hooks` | 2–6 opening lines; each video uses a different one |
| `problem` | optional "before" line for story videos |
| `points` | selling points: strings, or `{"text", "media"}` to show a specific image with that line |
| `cta` | closing line, e.g. "Try it free. Link in bio." |
| `voices` | any of `joe`, `kristin`, `norman` |

Copy the brief's required talking points and claims **word for word** from the brand's brief, and don't add claims the brand didn't approve.

## Posting checklist

TikTok:
- **More options → Content disclosure** → on → **Branded content**. TikTok adds its official "Paid partnership" label; brand deals without it can be removed.
- Post with the video's own sound: branded content can't use regular TikTok songs (only the Commercial Music Library). The generated background beat is original.
- Keep `#ad` in the caption and the on-screen label.

YouTube Shorts:
- YouTube Studio → Details → Show more → **Paid promotion** → tick "My video contains paid promotion".

Both:
- Submit each posted link in the campaign dashboard.
- Watch every video once before posting.
