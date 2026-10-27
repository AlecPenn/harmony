# Handoff log

Newest entry at the top. Every agent writes one before stopping (see `AGENTS.md`). Copy the template.

```markdown
## YYYY-MM-DD · <Agent name> → <next agent>

**Done:** what was finished, with file names and commit hashes.
**Verified:** what was tested and how (commands run, what passed). Say plainly what was NOT verified.
**Half-done:** anything started but not finished, and where it stands.
**Broken / risky:** anything failing, fragile, or that the next agent could trip over.
**Decisions:** choices made and why (also recorded in ROADMAP.md).
**Questions for Alec:** anything needing his call.
**Next step:** the single most useful next thing, specific enough to start immediately.
```

---

## 2026-10-27 · ChatGPT → next agent

**Done:** `a9b6552` adds Windows CI; `6794445` records its successful GitHub run. `11fee40` adds private home-town Settings and the weather fallback. `241c650` isolates the desktop test profile and adds a Settings UI test. `ba6f2f1` gives three previously timed-out disk-heavy tests a bounded 20-second allowance. The earlier authentication blocker was resolved; the previous handoff commits were pushed.
**Verified:** `npm ci`, `npm run typecheck`, `npm run build`, and `npm test` passed locally (658 passed, 7 skipped). `npx vitest run tests/web.test.ts tests/profile.test.ts` passed (12 tests). `npx playwright test apps/desktop/tests/home.spec.ts` passed with an isolated test profile. GitHub Actions run 40564500138 passed all Windows checks for `a9b6552`; run 40565769429 failed on a five-second timeout in the existing budget migration test. The full local suite passed after the timeout adjustment; the next GitHub run must be checked. A baseline test run had two timeouts; both passed in isolation and subsequent full runs passed.
**Half-done:** The first-run weather action asks for a town and offers Settings when home is unset, and a blank weather place uses saved home. A real spoken first-run/follow-up has not been verified; the checkout has no local model installed. Other local-info flows have not been checked. Leave the first-run roadmap item open.
**Broken / risky:** `npm audit` reports two high-severity dependency findings (Electron and undici). Do not assume model behavior or automatic conversational saving of a town: saving currently requires Settings. Live voice and real-model behavior were not tested.
**Decisions:** Home is saved in `data/profile.json`, preserving other fields and refusing to overwrite malformed JSON. Optional coordinates must be supplied together. The no-home weather prompt offers Settings rather than silently saving a spoken answer. Desktop test profiles use their own profile file to avoid changing a real one.
**Questions for Alec:** Can you test the first-run weather conversation in an installed HARMONY with its local model, or point the next agent to an appropriate test installation? Do not share your town or private profile in the repo.
**Next step:** Check the GitHub run for the timeout adjustment, then verify a no-home weather request and follow-up on an installed local model, including whether it asks and offers to remember without guessing; address any gaps, and check applicable local-info paths before ticking the first-run item.

---
## 2026-10-27 · ChatGPT → next agent

**Done:** Verified `a2a3cfc`; no fix was needed. Updated the Phase 0 verification checkbox in `docs/ROADMAP.md`.
**Verified:** `npm install` and `npm run typecheck` passed. Initial `npm test` failed: 653 passed, 7 skipped, and two unrelated tests timed out at 5 seconds (`tests/offsite-backup.test.ts` and `tests/reasoning-budget.test.ts`). Both timed-out files passed in isolation (15 tests); a second full run passed 655 tests with 7 skipped. The restricted process environment prevented the first test startup; full runs used elevated process permissions.
**Half-done:** CI has not been started; pushing this handoff is blocked by GitHub authentication.
**Broken / risky:** `npm audit` reported high-severity findings for Electron and undici. `git push origin main` failed with invalid username or token; no remote changes from this session were published.
**Decisions:** None yet.
**Questions for Alec:** Please restore GitHub push access or apply the local commits to the shared repository.
**Next step:** Push the local verification and handoff commits after restoring GitHub authentication; then add the Windows CI workflow and confirm it is green on GitHub.

---
## 2026-10-27 · Claude → ChatGPT

**Done:**
- Secrets scan of the public repo: all 537 tracked files checked for API keys, tokens, private keys, JWTs, email
  addresses, Windows user paths and family names. Clean. `.gitignore` already covers the sensitive folders.
- `a2a3cfc` — moved the owner's home town out of the source. `core/profile.ts` gains `home: {place, lat?, lon?}`
  read from `data/profile.json`; the `get_weather` tool in `core/assistant-actions.ts` no longer tells the model to
  assume Madison and now says to ask; `scripts/check-web.ts` and `scripts/check-gods-eye.ts` take the place from the
  argument → profile → a neutral default; `docs/PROFILE.md` documents `home`.
- Added `AGENTS.md` (rules for agents), `docs/ROADMAP.md` (the plan, moved here from a Claude-only doc so every agent
  can read it), and this log.

**Verified:** the four edited `.ts` files parse (`node --experimental-strip-types --check`). Nothing else.

**NOT verified:** `npm run typecheck` and `npm test` were **not run** — dependencies weren't installed in that
session. `a2a3cfc` is on `main` untested. Treat that as the first job.

**Half-done:** Phase 0 still needs a Settings UI for the home town, a first-run "which town?" prompt, CI, and a
changelog. Nothing is mid-edit.

**Broken / risky:**
- Tests in `tests/web.test.ts`, `tests/gods-eye.test.ts` pass `'Madison, Wisconsin'` explicitly as an argument. That
  is fine and should still pass — they don't rely on a default. If any test asserts the old `get_weather` description
  text, update the assertion, not the description.
- `readProfile()` now returns `{home}` even when there is no `job` section. Check callers that assumed `{}` meant "no
  profile at all" (search for `readProfile(`).

**Decisions:** home town lives in the git-ignored profile; no default town anywhere in code. Docs/UI copy that uses
Madison as an *example* and the Madison Metro integration were deliberately left alone.

**Questions for Alec:** the six open questions at the bottom of `docs/ROADMAP.md`.

**Next step:** run `npm install && npm run typecheck && npm test`; fix whatever `a2a3cfc` broke; then work Phase 0 in
order.

### Suggested plan for this week (ChatGPT)

Roughly one item per session. Stop and hand off whenever Alec ends a session — finishing fewer items cleanly beats
leaving several half-done.

1. Verify and fix `a2a3cfc` (above).
2. CI workflow on `windows-latest` (`npm ci`, typecheck, test). Confirm it goes green on GitHub.
3. Home town in Settings, saved to the profile, plus the first-run "which town?" behaviour.
4. `CHANGELOG.md` with an entry for the public release and the home-town change. Phase 0 is then done — tick it.
5. Phase 1 start: `docs/pack.schema.json` and `docs/PACKS.md` draft. Design the format on paper before writing the
   loader; it decides the next three phases.
6. Phase 1 loader: checksum verification, declarative-only enforcement, fail-soft fallback. With tests.
7. Repackage the current orb as pack #1.

If all of that is done and verified, carry on down Phase 1. Do not start Phase 3+ this week.
