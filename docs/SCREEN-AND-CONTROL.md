# Screen awareness and computer control (Phases 28 and 20)

## What you can say
- "Harmony, look. What does this error mean?" or "Read what's on my screen."
  - She says "Looking." and a "Looking at your screen…" badge shows.
  - She reads the app window you're using, skipping HARMONY's own window, answers, and throws the screenshot away.
- "Open Spotify." "Pull up YouTube." "Search the web for best pizza in Madison." "Switch to Chrome." "Pause the music." "Next track." "Turn it up 20%." "Mute."

## How looking works
- **Mode:** only on request, the default, or never. Set it in Settings, under Screen and computer control. Periodic and active watching (Phase 29) aren't built yet.
- **Capture:** `workers/desktop/desktop.ps1`, running in Windows PowerShell 5.1, finds the foreground window. If that's HARMONY, it takes the next real app window down.
  - It captures that window's own pixels with PrintWindow, so it works even under HARMONY. If an app draws blank that way, it falls back to what's on screen.
  - It reads the text with Windows' built-in OCR (`Windows.Media.Ocr`). Nothing is downloaded and nothing leaves the PC.
  - The bitmap lives only in memory and is disposed of before the reply is sent.
- **Screen report:** the model gets a short report:
  - the app and window title
  - the site, if it's a browser
  - "possibly related to project X", only when the name appears on screen, and labelled as not certain
  - lines that look like errors
  - up to about 900 characters of text, with lines matching the question first
  - It's labelled as screen data, not instructions, so text on screen can never make her do anything.
  - It's answered in the second pass, which can't run actions.
- **What's kept:** only the time, app name and title of the last look, shown in Settings. The text is not kept.

## How control works
- **Allowed actions:** open an app, open a website, switch to a window, and media and volume keys. That's all: no typing, clicking, deleting or buying.
- **Who decides:** HARMONY, not the model.
  - Apps must exist in the Start menu (`Get-StartApps`) and are launched by exact AppID. Uninstallers are never matched.
  - Websites are known names, plain domains, or else a Google search. Only `http(s)` addresses to a named host are allowed: no credentials, quotes or other schemes. They're checked in Node and again in the script.
  - Windows are matched from the list of open windows.
- **Safety:** each action is an allow-listed `LOW_RISK_WRITE`, journaled, with an honest undo:

  | Action | Undo |
  |---|---|
  | Open app | Closes exactly the windows that launch opened. If the app was already open, there's nothing to undo. |
  | Switch window | Switches back. |
  | Volume up and down | Undo each other. |
  | Next and previous | Undo each other. |
  | Mute, play/pause | Toggle back. |
  | Open website | Says it can't undo (closing browser tabs from outside isn't safe). |

- **Never run as code:** model text is never run as PowerShell. The script accepts only fixed commands with checked values.
- **STOP:** stops the helper process.
- **Settings:** controls are on by default, and can be turned off in Settings.

## Checks
- `tests/desktop.test.ts`, using a fake helper:
  - app, window and website matching, and refused addresses
  - the screen report
  - looking only through its function, with only the title kept
  - journaled actions and undo
  - settings and the off-Windows behaviour
  - the PowerShell transport protocol
- The script was syntax-checked with PowerShell 7, and its C# was compiled. It hasn't been run on Windows from here.
- On Alec's PC: `npm run desktop:check` lists apps and windows and reads the active window, without controlling anything. `npm run local:tools-check` now has 9 more requests (look, control, recall).
