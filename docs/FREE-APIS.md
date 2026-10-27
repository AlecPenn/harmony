# Free public APIs worth plugging in

Checked from the development PC on October 26, 2026: each was called once, with no account or key, and the time
is how long the answer took. "Free forever" can't be promised by anyone, so the list favours sources least likely to
disappear: government data, open-data projects and long-running non-profits. HARMONY already uses Open-Meteo, NWS
alerts, USGS/EMSC quakes, GDACS, NASA EONET, NOAA space weather, NHC, NIFC, NWPS, FAA, CISA KEV, IODA, Wikipedia,
Google News RSS, DuckDuckGo/Mojeek and Madison Metro; those aren't repeated here.

## Recommended

| What HARMONY could do | Source | Kind | Answered in |
|---|---|---|---|
| "Any recalls on this water heater / fridge model?" | CPSC SaferProducts recalls | US government | 0.9 s |
| "Any recalls on a 2018 F-150?" and decoding a VIN | NHTSA recalls and vPIC | US government | 0.4 s |
| Spoken forecast text and hourly detail | NWS forecast (api.weather.gov) | US government | 0.3 s |
| "How's the air today?" | Open-Meteo air quality | Same provider as her weather | 0.5 s |
| "Is Monday a holiday?" | Nager.Date | Open source, free | 0.5 s |
| "What happened on this day?" for the morning brief or a radio segment | Wikipedia "On this day" | Wikimedia | 0.4 s |
| Song, artist and release details | MusicBrainz | Non-profit open data (asks for 1 request a second) | 5 s |
| "Play a lo-fi station" | Radio Browser | Community-run, free | 0.6 s |
| Free-to-use music, sounds and images | Openverse; Internet Archive | WordPress.org project; non-profit | 6 s; 0.4 s |
| Rhymes, synonyms, words that sound like... | Datamuse | Free, no key | 0.2 s |
| Definitions and pronunciation | Free Dictionary API | Community-run | 0.4 s |
| Currency conversion | Frankfurter (European Central Bank rates) | Open source | 0.5 s |
| Lake and river levels (e.g. Lake Mendota) | USGS Water Services | US government | 0.3 s |
| Turning an address into a map point | US Census geocoder | US government | 0.4 s |
| Monthly model scout and engine update checks | Hugging Face; GitHub releases | Free, rate-limited | 0.2 s; 0.4 s |
| Upcoming rocket launches on the globe | Launch Library 2 | Free tier (15 requests an hour) | 0.3 s |
| Scanning a product barcode | Open Food Facts | Open data | 1.0 s |
| Food and medicine recalls | openFDA | US government | 0.6 s |
| Book lookups | Open Library | Internet Archive | 1.2 s |

## Not reliable enough today

| Source | What happened |
|---|---|
| OpenStreetMap Overpass (places nearby) | Timed out after 25 s; the public server is often busy |
| CelesTrak (satellite orbits) | Its address didn't resolve from this PC; try again before relying on it |
| NASA APIs with the shared DEMO_KEY | Timed out; a free personal NASA key is the reliable way |

## Free with a free key (worth the sign-up)

- **SAM.gov opportunities**: US federal contract listings.
- **NASA (api.nasa.gov)**: picture of the day, asteroids, Mars photos, without DEMO_KEY's limits.
- **AirNow (EPA)**: official US air-quality readings and forecasts.

Keys go into HARMONY's encrypted vault (Settings), never into the code.
