# Long-term memory

## Checkpoint — October 19, 2026

HARMONY remembers things **only when you ask**: "Harmony, remember that Sam has soccer on Tuesdays." She does not quietly store conversations, recordings or anything she infers.

### Using it
- **Remember:** say or type "remember that …". HARMONY replies with fixed words: "Okay, I'll remember that …". If she already knows it, she says so.
- **Forget one thing:** "forget what I told you about the plumber" (best word match) or "forget that" (the most recent).
- **Forget everything:** only from the Memory panel, with two clicks. Asking by voice is refused on purpose ("To forget everything, use Forget everything in the Memory panel"), because a misheard sentence must never wipe memory.
- **Memory panel:** lists everything, newest first, with when and how it was saved (said aloud, typed, added here). You can add an item, forget one, or forget everything.

### How it works
- Memories live in the `memories` table of HARMONY's local SQLite database (migration 7) and never leave the PC.
- Limits: 200 items, 200 characters each. Text is cleaned and angle brackets are stripped, so a memory can't carry function-call markup.
- "Remember" and "forget" are the model functions `remember` and `forget`. They run as allow-listed `LOW_RISK_WRITE` tools (`memory.remember` and `memory.forget`) through the same checked, journaled and undoable dispatcher as reminders. Forgetting one item is reversible (it is marked FORGOTTEN). Forget everything deletes the rows for good.
- The model sees memories as a labelled block at the end of its instructions, newest first and capped at about 2,500 characters. It is told to use them when relevant and not to recite them unless asked. The block is read once when a voice conversation starts, so every turn shares the same cached prompt prefix and adding memory does not slow replies. A memory saved mid-conversation is used from the next conversation. Typed requests read it fresh each time.
- The model is told to call `remember` or `forget` only when the person explicitly asks.

### Check on your PC
`npm run local:tools-check` now includes memory requests ("Remember that my plumber is Dave…", "Forget what I told you about the plumber") and a sentence that must *not* be remembered ("I had a long day at work today").

## Semantic memory (Phase 22) — October 20, 2026

HARMONY can now find what you told her **by meaning**, not just by the same words. "The sink is leaking" brings up "Dave from unit 12 is my plumber". It all stays on this PC.

### Using it
- **Just talk.** When something you said clearly relates to a remembered fact that isn't already in her instructions, up to two short lines are added to that turn. Most turns add nothing, so most replies don't get slower.
- **"What did I say about…?" / "Do you remember…?"** This calls the new `recall` function, a read-only lookup. It searches remembered facts, project notes and (if turned on) past conversations, then answers from dated matches in the pass that can't run actions.
- **Forget by meaning:** "forget the thing about the guy who fixes pipes". If two memories are too close to call, she won't guess.
- **Memory panel:**
  - a search box
  - Pin and Unpin; pinned items are always in her instructions
  - a **Remember our conversations** switch, which is **off** by default. When it's on, the text of each exchange is kept for 90 days, capped at 3,000 exchanges, and no audio is kept.
  - "Forget conversations", which takes two clicks

### How it works
- **Model:** IBM Granite Embedding Small English R2.
  - 47M parameters, 384 dimensions, Apache-2.0.
  - ONNX export by onnx-community.
  - Runs on the CPU with 2 threads in `workers/memory/embed_worker.py`, using onnxruntime and tokenizers, which the speech setup already installs.
  - It starts when a conversation starts and stops after 5 quiet minutes.
- **Setup:** double-click `Set up memory search.cmd` (also run at the end of `Set up local brain.cmd`). It runs `scripts/setup-memory-model.py`: about 200 MB, once.
  - It pins the repository revision and checks every file against Hugging Face's published hash for that revision, then writes `docs/MEMORY-MODEL.json`.
  - The worker re-verifies sizes and hashes before loading. A full re-hash only happens when a file changes.
- **Ranking (`core/recall.ts`) is never similarity alone.** Relevance blends meaning (70%) and BM25-style word weighting (30%). On top of that:
  - Recency: facts have a half-life of about 6 months, conversations about 1 month.
  - +0.06 for the current project.
  - A bonus for pins.
  - Without the model, words alone decide. Search never waits more than 0.4 s per spoken turn; past that, words decide.
- **Instructions:** with meaning search, the always-present memory block is shorter (about 1,200 characters, pinned first), because the rest comes up when relevant. Without it, it stays at about 2,500 characters.
- **Storage:** migration 10.
  - Memories gain `project_id` (the current project when saved) and `importance` (pins).
  - New tables: `episodes`, `embeddings` (one vector per item and model, so changing models re-indexes) and `memory_settings`.
  - Forgetting removes the vector too. Vectors for anything deleted are pruned on each indexing pass.
- **Exact history:** the related lines are part of the exact text sent and kept in history, so the next turn still reuses the engine's cache.

### Check on your PC
`npm run memory:check` loads the model and reports how fast a query is. It also shows whether 9 related phrasings find the right memory and 4 unrelated ones add nothing, and prints the related and unrelated score ranges. The meaning thresholds (`MEANING_FLOOR`, `MEANING_CEIL`, `RELATED_MEANING` in `core/recall.ts`) are set from Granite's typical range and will be adjusted from those numbers.

### Not yet
- Per-person memory once household voice identity is enabled.
- Inferred facts. HARMONY still never saves something you didn't ask her to.
