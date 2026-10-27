# Hand signs

HARMONY reads a few hand signs through the PC's camera, entirely on this PC.

| Sign | When | What it does |
|---|---|---|
| Open palm, held still about a second | She's thinking or talking | Stops her, like saying "stop". She listens straight away. |
| Thumbs up / thumbs down, held about a second | An approval is waiting on the screen | Approves / refuses it, but only if the same camera frame shows your live face. |
| Wave (open palm, side to side and back) | Hands-free, waiting for "Harmony" | Wakes her. Off by default. |

Turn each one on or off in Settings → Hand signs. Turning on "thumbs up approves" needs your approval.

## Privacy and safety

- The camera opens only while a sign could mean something: while she talks, while an approval waits, or (only if you
  turn on waving) while she waits to be woken. The camera light shows when she's watching, and a small "✋" note says why.
- Frames (480×360, about six a second) go to the guard worker, which returns only the 21 joint positions of a hand.
  Nothing is saved.
- A thumbs up never answers a phone approval and never unlocks her. If no face is set up, or the face isn't yours, or
  it looks like a photo, the sign is ignored and logged. The monthly security drills include a stranger's thumbs up.

## Models

Two pinned models from OpenCV Zoo (Apache-2.0): the MediaPipe palm detector and hand landmark model, 8 MB in all,
listed in `GUARD-MODELS.json`. Run **Set up security.cmd** once to install them; nothing downloads at run time.
