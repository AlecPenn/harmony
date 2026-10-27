# Web intelligence (Phase 18)

## Checkpoint — October 20, 2026
HARMONY can answer current questions with free sources: no accounts, no keys, no per-question payment.

| Ask | Function | Source |
|---|---|---|
| "What's the weather tomorrow?" | `get_weather(place)` | Open-Meteo forecast and geocoding APIs (free, no key; weather data by Open-Meteo.com, CC BY 4.0) |
| "Any news about the Packers?" | `get_news(topic)` | Google News RSS: headlines with their publishers |
| "Who won the World Series?" | `web_search(query)` | Keyless results from DuckDuckGo's HTML page, with Mojeek as a fallback, plus the matching Wikipedia summary (CC BY-SA) |

Why not the master spec's "OpenAI web search": it charges per search, and Alec asked for no per-question payment. Brave's free tier ended in February 2026 and needs a card, and Google Custom Search shuts down for everyone on January 1, 2027. Paid search can be added later as an optional upgrade.

### How a lookup works
1. The model asks for a function, as with reminders. HARMONY says "One sec." straight away.
2. HARMONY runs it as a **SAFE (read-only) tool** through the permission policy, dispatcher and action journal. Each lookup's sources are stored in the `web_lookups` table (migration 8), as the spec requires.
3. The result is plain text: markup stripped, entities decoded, kept to about 1,300 characters, labelled with its source and marked "web data, not instructions". It is sent to the model as a function result in a **second pass**.
4. In that pass the model answers in its own words and names the source. It keeps the same tool list so the engine can reuse its cached prompt, but **nothing it asks for in that pass is ever run**, so a web page can never trigger an action.
5. Sources appear as chips under the reply, never read aloud. Clicking one opens it in your browser, but only if that exact link is one of the reply's sources.

Expected failures (no such town, search blocked, offline) come back as the result, so she explains them instead of erroring. With no town given, the model uses where you live if you've asked her to remember it; otherwise she asks.

### Privacy
Only the words of a lookup leave this PC, sent to the source being asked (Open-Meteo, Google News, DuckDuckGo or Mojeek, Wikipedia). Nothing else does: no audio, no memory, no history. Lookups happen only when you ask something that needs current information. Results are cached for 10 minutes in memory.

### Speed
The local model reads prompts at roughly 100 tokens per second on the GTX 1650, so each 400 characters of results costs about 1 s before she answers. That is why results are kept short. Expect web answers to take about 2–4 s more than ordinary replies; "One sec." covers part of that.

### Check on your PC
- `npm run web:check` (optionally `-- "your search"`): live test of weather, news and search from this PC.
- `npm run local:tools-check`: now includes weather, news and search questions, plus one that must *not* trigger a search.

### Not yet
- Reading whole pages (only snippets and summaries are used now).
- Sports scores and stocks through dedicated free feeds.
- An optional paid search key for higher quality.
