# «الروليت» — recorded sound effects (P3): source, prompts, licence

The dramatic moments of the roulette play recorded sounds instead of synthesised ones. The files are in
`public/roulette/audio/`, loaded by `public/roulette/sfx.js`; each one falls back to its synthesised version while it
loads or if it cannot be loaded. The quick, repeated sounds (reel ticks, the cylinder's ratchet, the last-five-seconds
countdown, the whoosh, cancel/host decisions) stay synthesised — no file, no latency.

## Source and licence

- **Source:** generated for this game with the **ElevenLabs Sound Effects API** (`POST /v1/sound-generation`) on
  2026-11-12, with the prompts below. No third-party recordings, samples or libraries.
- **Licence:** owned by the account holder under the ElevenLabs Terms of Service. **Commercial use requires a paid
  ElevenLabs plan** (free-plan output is for non-commercial use with attribution). The plan of the key used here was
  not visible to the tool (restricted key) — **the owner must confirm the plan** before relying on these files in a
  commercial product. If the plan does not allow it, delete `public/roulette/audio/`: the game falls back to its own
  synthesised sounds automatically.

## Files

| File | Event in the game | Prompt (duration, prompt influence) | Level in the mix |
|---|---|---|---|
| `bang.mp3` | The shot (outcome «OUT») | "single revolver gunshot indoors, sharp loud crack, deep punchy low-end thump, short room reverb tail, no music, no voice, game sound effect" (1.6 s, 0.7) | 1.00 |
| `click.mp3` | The dry «تكة» of an empty chamber | "loud sharp metallic click of a revolver trigger snapping on an empty chamber, dry fire, single hard click with a tiny metallic ring, close microphone, no music, no voice" (0.8 s, 0.8) — the first prompt gave a near-silent file (peak −47 dB) and was dropped | 0.85 |
| `cock.mp3` | The hammer cocked during the aim | "revolver hammer being cocked back by a thumb, two-stage metallic click-clack, close microphone, short, no music, no voice" (0.7 s, 0.75) | 0.75 |
| `heartbeat.mp3` | The tension at the end of the aim | "one deep tense heartbeat, two low muffled thumps lub-dub, cinematic suspense, no music, no voice" (0.9 s, 0.7) | 0.95 |
| `picked.mp3` | The reel stops on the turn holder | "short dramatic reveal hit for a live game show when a player is selected, bright metallic impact with rising shimmer, no voice" (1.2 s, 0.6) | 0.45 |
| `out.mp3` | The elimination sting after the shot (+0.35 s) | "dark dramatic elimination sting for a game show after a gunshot, deep descending low brass and boom hit, ominous, no voice" (2.0 s, 0.6) | 0.40 |
| `relief.mp3` | Survived — empty chamber (+0.18 s) | "short relieved positive chime for a game show when a player survives, three soft bright rising mallet notes with a sparkle, no voice" (1.4 s, 0.6) | 0.55 |
| `win.mp3` | The winner's screen | "triumphant short victory fanfare for a game show winner, bold brass and orchestral hit with a sparkling cymbal swell, celebratory, no voice" (3.5 s, 0.55) | 0.50 |

## Processing (ffmpeg)

Leading silence trimmed (−45 dBFS), mono, 44.1 kHz, peak-normalised to −1 dBFS, 30 ms fade-out, MP3 96 kbit/s.
All eight files: 160 KB. Measured after processing (duration · peak · integrated loudness):

| File | Duration | Peak | Loudness |
|---|---|---|---|
| bang | 1.65 s | −1.4 dB | −24.7 LUFS |
| click | 0.50 s | −0.7 dB | −21.9 LUFS |
| cock | 0.73 s | −1.5 dB | −28.6 LUFS |
| heartbeat | 0.91 s | −1.4 dB | −25.0 LUFS |
| out | 2.04 s | −1.4 dB | −12.0 LUFS |
| picked | 1.23 s | −1.0 dB | −18.0 LUFS |
| relief | 1.41 s | −1.4 dB | −20.1 LUFS |
| win | 3.53 s | −1.5 dB | −14.3 LUFS |

The levels in the mix balance the loud stings (OUT, the fanfare) against the short transients; everything goes through
the game's compressor (threshold −14 dB) so the stream's audio never clips.

## Not verified

The sounds were checked by measurement and waveform only — nobody listened to them in this sandbox. Listen once on the
stream (OBS) and adjust the levels in `RECORDINGS` in `public/roulette/sfx.js` if one is too loud or too soft.

## A bug found on the way: the winner's fanfare never played in a real match

Found by the new end-to-end test (a whole match by chat on the OBS screen). When the last shot ended the match, the
server kept the last result's start time as the start of the winner scene, so every screen believed the winner scene
had started `resultSeconds` earlier. The fanfare only plays in the first 1.5 s of that scene (a late screen must not
replay it), so it never played, and the trophy's rise animation was skipped for the same reason. Measured on the OBS
screen: the winner scene appeared **4.05 s** "late" before the fix, **16 ms** after. `main` has the same bug.
Fix (`src/roulette.mjs`, `finish()`): the winner scene starts when the match ends. Covered by a unit test.

## Tests (written first — each seen failing)

`tests/roulette-audio.test.mjs` (new; no database needed — runs in CI):

| Test | Covers |
|---|---|
| files and sheet | the eight files exist, 2–80 KB each, under 300 KB together, each listed here with its source and licence |
| served as audio | the server sends each file with `audio/mpeg` (it was an unknown type and not in the static allowlist) |
| in the browser | all eight decode; each event plays its recording (not the synthesised one — mutation-checked); with the files blocked (404) every event still sounds, synthesised; with sounds off nothing plays; no page errors |
| a whole match by chat | on the OBS screen: picked, cock, heartbeat, bang, OUT, (click, relief on an empty chamber) and the fanfare exactly once |
| the winner scene starts when the match ends | the bug above |

**Full suite** (isolated throwaway PostgreSQL, deleted afterwards): **375 tests — 374 pass, 1 fail**. The failure is the
known load-sensitive `roulette-ui › the OBS screen follows every scene…` (it fails on `main` too under load; see the P2
report); it passed 3/3 alone after this change.

## 3D assets (Tripo): not done

The Tripo key is valid but the account balance is **0 credits**, so no 3D model could be generated. The revolver,
table and trophy stay the original code-built models (P2). Once credits are added, generated models can be compared
against them and kept only if they look better and stay light.
