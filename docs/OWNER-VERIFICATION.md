# Local owner verification

## Decision and reference audit - October 15, 2026

HARMONY uses native Windows WebAuthn through the pinned Yubico python-fido2 library. This PC runs Windows 10 build 19045; the noninteractive probe reports native WebAuthn API version 2 available. This does not prove Windows Hello is configured or that enrollment will succeed. No real enrollment or authentication has been attempted by the builder.

| Reference | Inspected implementation / dependencies | Decision and HARMONY equivalent |
| --- | --- | --- |
| [Yubico/python-fido2](https://github.com/Yubico/python-fido2) | Installed 2.2.1 wheel: fido2/client/windows.py uses WindowsClient, native cancellation and parent HWND; fido2/server.py validates challenge, RP, origin, presence, UV and assertion signature. Depends on cryptography and its cffi/pycparser chain. | Adapt through imports, not wholesale copying. workers/owner/verification.py adds strict requests, exact origin, cross-origin denial and monotonic signature-counter handling. workers/owner/worker.py owns the native call. |
| [Microsoft native WebAuthn](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/webauthn-apis) | OS WebAuthn API available from Windows 10 version 1903; platform authenticator, user verification and native cancellation. | Use native platform enrollment with required user verification. No browser localhost listener or remote relying-party service. |
| [UserConsentVerifier desktop interop](https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/nn-userconsentverifierinterop-iuserconsentverifierinterop) | Desktop interop minimum Windows 11 build 22000. | Reject for this Windows 10 installation. A separate HARMONY passphrase is deferred; no insecure fallback. |

The application integration is original. Dependency notices are preserved under third-party/owner-verification. fido2 includes BSD, Apache and MPL notices; cryptography includes Apache/BSD notices; cffi and pycparser licenses are preserved. No reference repository was cloned into HARMONY.

## Boundaries

Only the main chamber can request setup. Inspecting settings never opens Windows authentication. Windows owns the PIN/biometric dialog and private authenticator key. HARMONY stores only the public credential and counter using the existing protected Windows-profile store; no PIN, biometric, private key or assertion is logged. The local relying-party namespace harmony.local and exact https://harmony.local origin are fixed native ceremony values, not a network endpoint.

The worker checks that the parent HWND belongs to its parent process. It accepts one bounded request, validates the native result and supports cancellation. Node limits output and runtime, drains diagnostics without recording sensitive payloads, and retains the busy latch until process closure. STOP, reload and shutdown revoke proofs; an unconfirmed worker shutdown prevents a false stopped state or Resume. Protected writes check cancellation before committing their temporary file.

Owner proofs are fresh, short-lived, single-use objects held only in the main process. Their challenge binds a random nonce to the exact action scope. Serialized or copied objects cannot confer authority. Positive authenticator counters must advance; authenticators reporting zero throughout remain supported. Clock rollback invalidates proofs. Enrollment cannot silently replace an existing owner record.

This verifies the local Windows-profile owner credential, not a named household speaker. Voice recognition never replaces this check. Windows-profile protected storage does not defend against an attacker already controlling this Windows account and application files. None attestation does not certify a particular hardware authenticator.

## Allowance integration status

BudgetAdministration.createVerified requires both an approved exact allowance and a fresh owner proof. It binds amount, beneficiary, budget ID, administrator and turn to that proof, then rechecks cancellation and authority before writing. The synchronous entry point rejects calls when an owner verifier is configured. Only local_desktop can administer its own allowance through this path; household delegation is not enabled.

The Settings allowance review is now connected to this core boundary. Production typed generation uses BudgetedReasoning: the reviewed estimate binds the exact prompt and local allowance, reserves before credential access, and persists dispatch before network access. Missing/exhausted allowances block generation. Startup recovery runs once after the application instance lock, releases unsent reservations and retains possible sends as uncertain; it never replays them. No allowance is created by owner setup. Billing reconciliation and allowance increases remain unavailable. This local estimated-cost control is not an OpenAI account limit or invoice guarantee.

## Reproducible dependencies

workers/owner/requirements.lock pins the exact downloaded Windows x64 / CPython 3.13 wheels and hashes. It is intentionally platform-specific. From the project root, install using the existing Python 3.13 environment:

```powershell
.venv/Scripts/python.exe -m pip install --require-hashes --only-binary=:all: --no-deps --target .runtime/owner -r workers/owner/requirements.lock
.venv/Scripts/python.exe -I workers/owner/worker.py --probe
.venv/Scripts/python.exe -m pytest workers/owner -q -p no:cacheprovider
```

The target and download cache are ignored runtime data. Do not fall back to an unpinned install on another platform; review that platform's wheel hashes first. The probe never prompts or enrolls. Real enrollment requires the user to choose Set up local owner and complete the Windows dialog.

## Validation

Twenty-one offline Python tests use real generated ES256 signatures to test successful ceremonies and rejection of incorrect signatures, challenge, origin, RP, presence, UV, cross-origin data, replayed counters and malformed requests. Core tests cover protected persistence, exact scope, object identity, expiry, cancellation, clock rollback and runtime STOP. Desktop tests verify chamber-only setup and companion denial without invoking a native prompt. The setup screenshot was visually reviewed. Live Windows Hello verification remains unverified.


## Allowance review controller

core/allowance-controller.ts now supplies the private review lifecycle for the upcoming UI. It accepts canonical USD text with at most two decimal places and converts via integer arithmetic. It fixes the beneficiary to local_desktop and the budget ID to local-owner-v1: repeating setup cannot mint a different allowance or reset a spent balance. Review expires after 60 seconds. The exact review ID can be approved once; native verification then runs with caller/STOP cancellation and a current-turn check before persistence. Snapshots contain no proof or credential. Tests cover decimal parsing, separate review/verification, wrong IDs, expiry, cancellation, delayed proof and preservation of existing spent balances. The controller is now wired to chamber-only IPC and the central runtime. Reviews are ACTIVE, Windows verification is BUSY, and STOP revokes reviews and waits for verification to finish. The companion cannot administer allowances. Settings displays current balance; the local budget is used for production typed generation. The UI never receives owner proof objects.
