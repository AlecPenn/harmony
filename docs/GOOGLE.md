# Google (Phase 17)

## Checkpoint — October 20, 2026
Read-only Google Calendar and Gmail, as the spec's first step ("Gmail read, Calendar read").

- **Ask:** "What's on my calendar tomorrow?", "Anything this week?", "Any new email?", "Did my landlord email me about rent?"
- **Functions:**
  - `calendar_events(when)` runs as the SAFE tool `calendar.list`: events from every visible calendar (hidden ones skipped), sorted, with all-day events marked.
  - `check_email(query)` runs as the SAFE tool `gmail.search`, using Gmail's own search syntax (default `is:unread newer_than:2d`). It reads only sender, subject, date and Gmail's short preview, never full bodies or attachments.
- Each function is offered to the model **only while that permission is connected**. Both run through the permission policy, dispatcher and journal.
- Answers use the same action-free second pass as web lookups, because email text is untrusted. Sources link back to Calendar or the message in Gmail. Calendar and mail contents are not logged anywhere.

## OAuth, done properly
- Your own Google Cloud **Desktop app** client, imported from its JSON file. HARMONY ships no Google client, and Web-application clients are refused.
- A loopback redirect to `127.0.0.1` on a random port, **PKCE (S256)** and a random `state`. A wrong `state` is refused, and there is a 5-minute limit. The flow matches Google's current desktop-app guidance.
- **Separate scopes:** `calendar.readonly` and `gmail.readonly`, chosen by checkbox. Google does not support adding scopes incrementally for desktop apps, so any change is a new, visible sign-in listing exactly what is asked. Scopes are never enlarged silently, as the spec requires.
- The refresh token and client file are encrypted with Windows protected storage (the same as the OpenAI key) at `credentials/google.enc`. Access tokens live in memory only.
- **Disconnect** revokes the token at Google. **Remove Google from this PC** deletes the client file and the sign-in.
- **Testing-mode projects expire sign-ins every 7 days.** HARMONY detects `invalid_grant` and shows "Reconnect Google". To stop the weekly expiry, publish the Google project (Audience → Publish). Google then shows a "hasn't verified this app" warning when signing in; it is your own app, so choose Advanced → continue.

## Setup (once, about 10 minutes)
1. Google Cloud Console: create a project called HARMONY.
2. Enable the Google Calendar API and the Gmail API.
3. Google Auth Platform: fill in Branding, set Audience to External, add yourself as a test user.
4. Clients → Create client → Desktop app → Download JSON.
5. HARMONY → Settings → Google Calendar and Gmail → Choose client file → tick Calendar and/or Gmail → Connect Google, then finish in the browser.

## Not yet (later, each its own approval-gated step)
`gmail.draft`, `gmail.send` (sending stays approval-gated), `calendar.find_time`, `calendar.create`, `calendar.move` and `calendar.cancel`. Each needs a wider scope, requested with its own visible sign-in.
