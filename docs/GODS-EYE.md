# God's Eye in HARMONY

HARMONY runs **God's Eye View** ([bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view), MIT): a live
3D globe of public world data. It runs in its own window and is managed by HARMONY. Phase 2 will merge Alec's
God's Eye v9 feeds into it as extra layers.

## Setting it up (once)

1. Double-click **Set up God's Eye.cmd**. It downloads God's Eye View at one exact commit (pinned in
   `docs/GODS-EYE-VIEW.json`, about 90 MB), checks its exact size and SHA-256, and unpacks it into `.runtime/gods-eye-view`
   (not in git). It then installs its parts with `npm ci`, which checks every package against the lockfile's integrity
   hashes. It needs Node 24.14 or newer.
2. Optional: `npm run godseye:check` starts it the way HARMONY does and asks six real questions (flights, earthquakes,
   the ISS, storms, launches, an overview of your area), printing the answers and timings.

## Using it

- **"Harmony, open God's Eye"**, or the gold **God's Eye** button at the top of HARMONY.
- **Ask about the world:** "show me flights over Chicago", "any earthquakes today?", "when can I see the ISS?",
  "any hurricanes?", "recent rocket launches", "military planes near San Diego", "what's going on in Tokyo?",
  "datacenters in Virginia", "traffic in Madison", "ships near Rotterdam", "show me the wind".
  HARMONY picks the source from your words (`routeQuestion` in `core/gods-eye.ts`; no extra brain pass), asks God's Eye
  through its local MCP endpoint, says the answer from that live data, and shows it on the globe: layers on, the
  camera flies there.
- **"Close God's Eye."** The server also stops by itself after 20 quiet minutes with the window closed, and STOP or
  quitting HARMONY stops it too.

## How it's kept safe

- Its server listens on 127.0.0.1 only. HARMONY talks to its `/mcp` endpoint with no Origin header. God's Eye itself
  only accepts requests that are plainly local: a loopback address and Host, no proxy headers, and sharing off.
- The window has its own browser profile, separate from HARMONY's (whose profile blocks the web). It may only show pages
  from that local server, and outside links open in your normal browser. Camera, microphone, location and other
  permissions are refused.
- HARMONY drives the globe with God's Eye's own app actions (the ones its voice control uses), passing the view as
  data. Only range-checked fields are used.
- God's Eye only reads public feeds. The `gods_eye` function counts as public, so guests and a locked HARMONY can use it,
  but it can't reach anything personal.
- God's Eye's own paid voice features (OpenAI or Gemini keys) are not set up or used.

## World feeds from God's Eye v9 (phase 2, first part, done)

HARMONY now reads v9's free, key-less sources itself (`core/world-feeds.ts`; the parsing follows v9's `server.py`). They
answer through the same `gods_eye` function and appear as coloured pins on the globe: red is serious, amber is notable,
cyan is informational. They also work before God's Eye View is set up, as answers without the globe.

| Ask about | Source |
|---|---|
| volcanoes, eruptions | USGS HANS elevated volcanoes, GDACS, NASA EONET |
| tsunami, floods, tornadoes, severe weather, warnings | US National Weather Service (severe and extreme), GDACS |
| disasters | GDACS 7-day global alerts |
| internet outages | IODA (Georgia Tech) |
| space weather, solar flares, geomagnetic storms | NOAA SWPC (Kp index, GOES X-ray) |
| auroras, northern lights (needs a place) | NOAA SWPC OVATION |
| fireballs, meteors | NASA/JPL CNEOS |
| asteroids | NASA NeoWs (a free demo key, or your NASA key once keys are moved) |
| airport delays, ground stops, flight delays | FAA NAS Status (US airports; pinned where known, including Madison and Milwaukee) |
| exploited vulnerabilities, cyber, ransomware | CISA Known Exploited Vulnerabilities (last two weeks; software you use comes first) |
| hurricanes, tropical storms | NOAA National Hurricane Center (Atlantic, east and central Pacific); the globe also shows God's Eye View's forecast cones |
| wildfires | NIFC WFIGS current US wildfires (size, containment); the globe also shows God's Eye View's fire perimeters |
| rivers, flooding | NOAA National Water Prediction Service gauges at or forecast to reach flood stage, around a place (the whole US is too slow to fetch) |
| earthquakes (watch zones, brief) | USGS plus EMSC (worldwide, often quicker), merged without duplicates |
| "world brief" | disasters, alerts, volcanoes and space weather together |

Answers are framed hope-forward, as in v9: the facts first, then what they mean for you or what's being done. With a
place ("near Madison"), only events within a sensible radius are kept, with their distance. **Check God's Eye.cmd**
tests every feed live and then God's Eye View.

## Your v9 keys

Settings → God's Eye → **Import keys from v9** reads only the known key names from `God's 3rd Eye\server.py` on your
Desktop (not your email, and not anything inside functions). It stores them in `credentials\world-keys.enc`, encrypted
with Windows. Only their names are ever shown, and never their values. With a phone paired, importing or forgetting
them needs a phone approval. God's Eye View gets the ones it supports as environment variables when it starts:
`FIRMS_MAP_KEY` (live fires), OpenSky OAuth (more aircraft) and `AISSTREAM_API_KEY` (live ships). NeoWs uses your NASA
key. **The keys are still in v9's server.py itself.** Once they're imported, consider moving them out of that file, and
rotate the OpenSky secret if it's a reused password.

## Watch zones

"Harmony, **watch Madison**." Every 10 minutes HARMONY checks earthquakes (USGS), severe weather alerts (NWS),
disasters (GDACS), volcano alerts and natural events within 150 km. You hear about each new, notable event once, through
the interruption engine (focus, ghost mode and quiet hours are respected). What was already happening when you started
watching isn't news. "What are you watching?" and "stop watching Madison" also work. You can watch up to 5 places.
Undo works too.

## Morning world brief

The first time you're at the PC between 5 and 11:59 in the morning, HARMONY gives a short brief: the biggest
events overnight, what's near your watched places, and notable space weather. It happens once a day, and you can turn it
off in Settings → God's Eye. "Harmony, morning brief" or "world brief" gives one any time.

## Community-fork features (October 26)

God's Eye View has about 3,300 forks. The best ideas from them for HARMONY, all MIT licensed and credited in
`overlays/gods-eye/README.md`:

- **Up to date:** God's Eye View moved to its October 26 version (204 fixes since the last pin, including paused polling
  in hidden windows and freeing turned-off layers).
- **Lite mode** (on by default, switch in the God's Eye panel): lower resolution, 30 fps, no atmosphere, no Google 3D
  tiles, no blur, and lighter flights (fewer updates, no fleet 3D models, planes behind the Earth skipped). Made for
  this PC's GTX 1650 running beside HARMONY.
- **Faster layers:** measured on this PC, turning on cameras froze the globe for 12.7 s (panels re-laid out every
  frame), submarine cables for 4.6 s and data centers for 7 s (markers re-measured against the terrain). Those causes
  are fixed (the last two in Lite mode).
- **Pins stay on their side of the Earth** (they used to show through the globe).
- **More cameras:** about 3,700 more public traffic cameras with open licences: Illinois (Chicago), Spain, Iceland,
  Stockholm, Gothenburg and Lyon ("show me cameras in Chicago").
- **Spatial Memory:** your own tracks, geotagged photos and 3D scans on the globe, with playback (the button in the
  layer panel).
- **Ambient mode:** "Harmony, ambient mode" (or "living globe", "spin the globe") puts the globe full screen on the
  second monitor, turning slowly with the HUD hidden. "Stop ambient mode", Esc, or the panel button ends it.
- **Replay:** "replay today's earthquakes", "replay the disasters": HARMONY tours the events in time order, pinning each
  one and flying there.
- **Filters:** "only the serious disasters", "volcanoes this week", "earthquakes in the last 6 hours".
- **GPS jamming, in numbers:** "is GPS being jammed near Gdańsk?" HARMONY asks God's Eye View's GNSS-integrity feed
  (aircraft-reported navigation accuracy within 250 nautical miles) and says how many aircraft report degraded GPS,
  with gpsjam.org's bands: under 2% normal, 2-10% elevated, over 10% high. Without a place it shows the map.
- Already in God's Eye View: keyless flights when OpenSky is down (adsb.lol).

## Phase 2 (rest, next)

Added October 22: FAA airport status, CISA's exploited-vulnerability list, NHC hurricanes, NIFC wildfires, NOAA river gauges and EMSC earthquakes (formats checked against live responses on Alec's PC). God's Eye View itself already draws US radar, satellite and lightning (NOAA nowCOAST), hurricane cones (NHC) and fire perimeters (NIFC). EMSC's push stream connected but sent nothing in a 45-second test, so quakes are checked every few minutes instead. Left out on purpose: GDELT (HARMONY's own news lookup already covers it, and GDELT rate-limits hard), Bluesky (its search now needs a logged-in account) and the volcanic-ash advisories (published only as web pages; the volcano and disaster feeds already cover eruptions). Still to come: the key-needing feeds (conflicts, air quality, radiation, live AIS) once Alec imports v9's keys, plus proper layers inside God's Eye View.
encrypted store and are passed to God's Eye as environment variables (FIRMS, OpenSky and AIS map onto God's Eye's own
key names). Never in git.
