# Phone companion (Phase 39, first version)

## What you can do from your phone
- Type to HARMONY. Your phone keyboard's microphone works for dictation.
- Use the quick buttons: Idea, Status, Where was I?, Research.
- See notices, upcoming reminders and research progress.
- Press **STOP**.

Requests go through the same typed path as the Ask box on the PC, with the same functions, journal and undo.

## Setup
1. On the PC, open Settings → Phone companion and turn it on. If Windows asks about the firewall, allow **private networks** only.
2. On your phone, on the same Wi-Fi, open the address shown (for example `http://192.168.1.20:47800`).
3. On the PC, press **Show pairing code** and type the 6 digits on your phone.

## Safety
- **Off by default.** It runs only while it's turned on.
- **Home network only:** requests from any address outside your local network are refused.
- **Pairing:**
  - one 6-digit code, valid 10 minutes, 5 tries, used once
  - the phone then holds a random 256-bit token
  - this PC stores only a hash of it
  - up to 5 phones; you can forget any of them in Settings
- **The API:**
  - it needs the token
  - it only accepts JSON from the page's own origin, with bodies up to 8 KB
  - the page has a strict Content-Security-Policy, shows all data as text (never HTML), and loads nothing from outside
- **Known limit:** it's plain HTTP on your own Wi-Fi. Someone already on your network could watch the traffic. Phone voice (microphone in the browser) and push notifications both need HTTPS with a certificate your phone trusts, so they're the next step.
