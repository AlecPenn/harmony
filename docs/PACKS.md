# HARMONY packs — draft format

**Design draft, not a working feature.** HARMONY does not yet load, install, or hot-reload packs. A standalone core
manifest-structure validator exists, but it does not validate a pack for use. This
specification is intended to guide the Phase 1 implementation and may change before the first pack ships.

A pack is a directory directly under `data/packs/`, with `pack.json` at its root and one purpose: `skin`, `voice`,
`theme`, or `sounds`. Packs contain data and media only. They cannot supply JavaScript, native modules, commands,
web pages, scripts, or other executable content. Core-owned engines interpret allowed data; packs never choose or
supply an executable. A skin's optional fragment shader is data for a constrained renderer, not a general plugin.

## Manifest

[`pack.schema.json`](pack.schema.json) describes the manifest structure using JSON Schema draft 2020-12. A pack has:

- `formatVersion`: `1`, identifying this manifest format.
- `id`: a stable, lowercase reverse-domain-style identifier, such as `org.example.crystal`.
- `name`, `author`, and `homepage`: display name, creator credit, and an HTTPS page for support.
- `version`: the pack's semantic version; `harmonyVersion`: the minimum compatible core version.
- `license` and `attribution`: a licence identifier or expression and the credit to show. An SPDX expression is
  recommended. Creators are responsible for the rights to every included model, recording, texture, and other asset.
- `files`: every payload file's relative path mapped to its lowercase SHA-256 digest. `pack.json` is excluded to avoid
  a self-referential digest. All other files, including previews and licence text, must be listed.
- `capabilities`: optional `webgl2` and `minGpuVramMiB` requirements; `{}` means neither requirement is declared.
  The values are minimum requirements, not a promise of performance. A future implementation must measure available
  resources safely and refuse a pack it cannot support; it must not let rendering slow audio or inference.
- `content`: paths that identify the assets for the selected type. Each path must also appear in `files`.

Paths use forward slashes and the restricted ASCII form in the schema. They are relative to the pack root. Absolute
paths, `.` and `..` segments, hidden path components, and backslashes are not accepted. The loader must additionally
reject Windows reserved names, trailing dots, case-insensitive collisions, links, reparse points, and paths whose
resolved files escape the pack directory. The manifest itself is not listed in `files`.

Illustrative theme manifest (the repeated zeroes are a placeholder, **not** the digest of a real file):

```json
{
  "formatVersion": 1,
  "id": "org.example.dusk",
  "name": "Dusk",
  "version": "1.0.0",
  "type": "theme",
  "author": "Example creator",
  "homepage": "https://example.org/dusk",
  "license": "MIT",
  "attribution": "Dusk by Example creator, MIT.",
  "harmonyVersion": "0.1.0",
  "files": { "tokens.json": "0000000000000000000000000000000000000000000000000000000000000000" },
  "capabilities": {},
  "content": { "tokens": "tokens.json" }
}
```

## Content by type

| Type | Required `content` | Optional `content` | Intended payload |
| --- | --- | --- | --- |
| `skin` | `model`, `moods`, `fallback` | `shader`, `preview` | GLB model, mood data, and a 2D light-mode fallback; optionally a constrained fragment shader and preview. |
| `voice` | `engine`, `model`; `voiceData` for Kokoro | `config`, `voiceData`, `sample` | Model and metadata for a core-owned `piper` or `kokoro` engine. The format of each engine's data remains to be specified. |
| `theme` | `tokens` | — | JSON semantic-token overrides, limited to the core's allowlist. |
| `sounds` | `cues` | — | JSON mapping of supported cue names to bundled audio paths. |

The skin mood file must cover exactly the nine core moods: idle, wake, listening, thinking, speaking, success,
warning, stopped, and offline. Packs cannot add moods. A standalone preliminary filename screen rejects extensions outside type-specific allowlists, but is not yet connected to a loader and does not inspect bytes or confirm that a reference has the right type.

The detailed mood, theme, sound, and voice payload schemas,
file extensions, size limits, shader uniforms, GPU tiers, and accessibility rules still need design and tests before
loading any of them. The current built-in orb is procedural; how it becomes a declarative pack is not yet settled.
The built-in orb remains the fallback until that is solved.

## Loader requirements before any pack can run

Schema validation is only the first gate. A future loader must, at minimum:

1. Parse bounded UTF-8 JSON, reject duplicate keys, validate the manifest, enforce a strict semantic version and
   compatibility policy, and reject missing or unusable licence/attribution information. It must not fetch schemas,
   execute content, or follow links from the manifest.
2. Enumerate the actual directory without following links; reject unlisted, missing, duplicate, unsafe, or executable
   files and unsupported content. Use type-specific allowlists and inspect file content, not just extensions. Check
   every referenced asset is listed, including references nested inside data files.
3. Check each listed file's SHA-256 over its bytes before it is used, and ensure the bytes used are the bytes checked
   even if the directory changes during loading. A checksum detects mismatches; it does **not** establish authorship
   or trust when someone can replace both manifest and files.
4. Validate type-specific data and resource limits before loading. Reject shader capabilities outside a strict
   allowlist, avoid unbounded GPU work, and keep rendering subordinate to audio and inference. Do not treat a manifest's
   resource claims as proof that a pack is safe or will perform well.
5. On any failure, report the pack and reason, retain or return to a trusted built-in default, and keep the app usable.
   Hot reload must validate a complete candidate before replacing the active pack and must not expose partially written
   files. It must never require executable pack code.

### Windows file-intake investigation

Node's Windows file-open flags do not include `O_NOFOLLOW`; checking a path and then opening it is therefore not by
itself a race-free no-link guarantee. A temporary experiment with `@openclaw/fs-safe` 0.26.13 in native `require`
mode rejected a junction and ran under the installed Electron runtime. Its own documentation describes Windows
containment as best-effort and does not claim session-wide protection against a concurrently changing directory.
Bundling it directly into the existing CommonJS build failed; treating it as an external dependency worked in the
small probe, but full application packaging, update behavior, and adversarial tests remain unverified. The library was
not added as a project dependency. Evaluate a handle-based or isolated-worker approach, retain the exact verified
bytes or a protected snapshot for consumers, and fail closed if the required protection is unavailable. Do not infer
that one successful junction test proves the whole intake safe.

References: [Node.js filesystem flags](https://nodejs.org/download/release/v24.17.0/docs/api/fs.html#file-open-constants),
[fs-safe native security model](https://github.com/openclaw/fs-safe/blob/main/docs/security-model.md).
The schema deliberately does not verify hashes, resolve paths, validate licence rights, enforce cross-file references,
or prove a pack safe. Those are implementation responsibilities and must have adversarial tests. Do not accept a pack
merely because it passes JSON Schema.

## Creating a pack later

Once the loader and payload schemas are implemented: create a directory with the appropriate assets; compute a SHA-256
for each payload file; add a `pack.json` matching the schema; validate with HARMONY's own pack checker; and copy the
folder into `data/packs/`. HARMONY should show the name, author, preview where available, and rejection reason if it
cannot use the pack. Selection and hot reload are roadmap work and are not yet available.

References: [JSON Schema draft 2020-12](https://json-schema.org/draft/2020-12),
[SPDX licence identifiers](https://spdx.org/licenses/).
