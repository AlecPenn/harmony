# Per-person permission foundation

Private core code only. No action executor, model tool endpoint, approval UI or machine-changing capability is enabled by this module.

The specification's four classes are implemented in `packages/permissions/policy.ts`:

- SAFE requires the person's configured permission set and a registered tool.
- LOW_RISK_WRITE is autonomous only for specifically owner-configured tool ids; otherwise it requires approval.
- CONFIRM always requires approval.
- RESTRICTED is blocked until a separately evaluated strong-authentication adapter exists. A voice match or ordinary confirmation is insufficient.

Canonical `credentials.export` and `security.disable` tool ids are permanently denied. Additional configured denies take precedence over all allows. There is no owner bypass, model-provided risk field or permission inferred from natural-language preview text. Registry declarations are trusted application code, not a security sandbox for malicious plugins. Dynamic skills must undergo their later review and permission-ceiling workflow.

Input hashing uses bounded canonical JSON, rejects invalid numbers, sparse arrays, accessors, non-JSON objects and dangerous property names, and normalizes object-key order. No raw inputs enter diagnostics. Input hashes are integrity evidence, not encryption; sensitive low-entropy inputs must not be made public simply because they are hashed.

`ActionApprovals` retains at most 64 in-memory tickets for 60 seconds. Tickets are non-serializable object-identity capabilities. The future trusted human-review adapter must be the only caller of approve(); no renderer/model endpoint is provided. Consumption is single-use and rechecks the current policy, identity authority, turn, tool version, risk and exact inputs. The returned reviewed input snapshot is recursively frozen; future execution must use that snapshot without post-approval argument mutation. Cancel, denial, expiry, identity loss, policy changes and STOP prevent reuse.

The identity authority is an injected trusted boundary, not implemented user authentication. It must validate a current HouseholdSessions context for the correct device/person before requesting or consuming approval. This module does not make private speaker evidence an action permission. Persistent action journaling and verification must be in place before consequential execution.

## Reference review

The pinned JARVIS audit's Safety and risk tiers and Action logging sections informed explicit tiers, readable review and action integrity. HARMONY rejects JARVIS's configured bypass mode, preview-text-only deny matching and post-approval hook mutation. No donor code was copied, so no new copied-code license applies. See [the source audit](JARVIS-REFERENCE-AUDIT.md), especially subsystem 8 and the action-journal discussion.

## Verification and remaining work

Tests cover per-person denial, unknown tools/people, configured writes, permanent denies, restricted actions, forged risk fields, immutable configuration, deterministic input hashes, invalid/accessor inputs, ticket replay, changed arguments, different people, expiry, STOP, identity revocation, changed policy/tool version and bounded pending reviews.

Remaining: trusted owner/admin setup; explicit role/permission configuration UI; authenticated device context; native human-review adapter; durable action journal; registered tools; result verification and undo. This is a Phase 12 foundation built independently while earlier live speech/identity work awaits external setup, not a completed Phase 12 release.
