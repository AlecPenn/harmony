# Personality, easter eggs and smart arrival

## Personality engine
- **Profiles:** Calm, Cheeky (the default, matching "A little order. A little attitude."), Coach, Roast and Custom.
- **Custom dials:** warmth, sarcasm, verbosity, energy, humor, proactivity and formality, set in Settings.
- **How it's applied:** HARMONY adds a short style note after her rules, and the note says it's style only, so it can never loosen safety, honesty or what she may do.
- **When it changes:** it's stable until you change it, so the prompt cache isn't disturbed; changes apply from the next conversation.
- **Verbosity:** follows the response policy: low means "Done."
- **Proactivity:** nudges the interruption engine (±0.1 on the score), so a quieter HARMONY shows more and says less.

## Easter eggs
They live in one table (`core/personality.ts`), each with a trigger, rarity, allowed personalities, cooldown and effect:

| Say | What happens |
|---|---|
| "Harmony, flex." | The presence pulses and glows. |
| "Harmony, impress me." | A glow sweep, and one line about running entirely on this PC for free. |
| "Harmony, dramatic mode." | The whole screen goes grayscale and serious for 6 seconds. |
| "Roast me." | Only with Cheeky, Roast or Custom. |
| "Thanks, Harmony." | Occasionally answered with a wink. |

- **Rare boot:** about one start in forty, the eyebrow line reads SYSTEM NOMINAL. USER UNSUPERVISED. for the first minute.
- **How eggs run:** they answer with fixed lines without loading the brain, and aren't kept in conversation history.
- **Reduced motion:** turns the effects off.

## Smart arrival (Phase 38)
- **Signals:** Windows lock and unlock, and the system idle time (keyboard and mouse) checked every minute. Away means 30 or more minutes.
- **When she speaks:** only if there's something worth saying, which she combines into one line:
  - reminders that went off while you were away
  - a calendar event in the next 45 minutes
  - research that finished while you were gone
  - or, failing those, several notices waiting

  Example: "Welcome back. While you were away I reminded you: call Dave, Unit 12 walkthrough starts in 20 minutes, and your research on silent disco costs is ready."
- **Routing:** it goes through the interruption engine, so in focus mode or at night it's shown, not said.
- **No greetings for their own sake.**
