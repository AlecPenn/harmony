# Tool registry and first read-only dispatcher

Trusted built-in tools have immutable id/version/risk/permission metadata, strict bounded input/output schemas, availability checks, execution and a separate verifier. Duplicate ids, unknown arguments, malformed schemas, non-JSON values and oversized inputs/outputs are rejected. Registration does not discover, import or install plugins. This is not a sandbox for hostile JavaScript.

The first dispatcher accepts SAFE tools only. All machine-changing risk tiers remain disabled even when a permission configuration would otherwise allow them. The dispatcher checks current turn and identity authority, validates and freezes inputs, evaluates permissions, persists PREPARED/RUNNING before execution, validates output, invokes verification, rechecks authority/policy and records SUCCEEDED before releasing results. Failed verification never becomes success. Required journal-write failure prevents invocation or successful reporting. Raw results and arguments stay out of the journal.

At most four calls and one call per turn may run in a dispatcher. Cancellation is cooperative through AbortSignal. Results arriving after cancellation or identity/policy loss are withheld. An adapter that ignores cancellation remains active until it settles; no claim is made that an abort signal kills arbitrary code. Long-running, process-owning or write-capable tools require supervised worker deadlines and verified cancellation before activation. No retries occur automatically.

## First real tool: computer overview

System → Inspect this computer runs `system.information`, showing only operating-system platform, architecture, available processor count and total memory. A separate read verifies those stable values. No hostname, username, files, processes, credentials or network data are collected.

The zero-argument IPC is restricted to the chamber's owned exact main-frame document. It uses an explicit `local_desktop` diagnostic actor with only `system_info`, consistent with the existing local health check. This is not an enrolled household identity and cannot authorize other tools. Identity stays UNKNOWN. No generic tool-execution IPC is exposed.

Recent local diagnostic actions appear in Activity after inspection. This is a narrow local-action projection, not the future per-person history UI. The database preserves action records across restarts. Runtime initialization recovers incomplete action rows before accepting new work; it never retries them.

## Source review and remaining work

The pinned JARVIS registry/permissions audit informed the formal contract. HARMONY rejects duplicate overwrite, arbitrary argument expansion, permissive dynamic module loading and pre/post-hook mutation of reviewed arguments. This is original code; see JARVIS-REFERENCE-AUDIT.md.

Remaining: reviewed plugin manifests, richer schemas where needed, trusted human-review adapter, authenticated household dispatcher, supervised long-running workers, write/undo adapters, task/project/file tools and result/artifact presentation. Phase 14 has a working built-in foundation and Phase 15 has its first scoped read-only tool; those phases are not fully complete.
