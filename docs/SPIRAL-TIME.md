# Spiral Time

Say **"Harmony, Spiral Time"** at night and HARMONY hands her heavy background work to Claude. Claude works through it
until your Claude usage limit stops it. Anything left stays queued for the next Spiral Time, and the morning brief tells
you what got done.

## What you say

| You say | What happens |
|---|---|
| "Save *the best NAS for a music archive* for Spiral Time" | Queued for Claude. HARMONY's local brain leaves it alone. |
| "Research *X*" | Researched locally as before. If it's still open at Spiral Time, it's handed off too. |
| "Spiral Time" (she also accepts "sprial time") | Writes tonight's ticket. Saying it again only tells you what's already handed off. "Undo" cancels it until Claude picks it up. |
| "Read me the research" | Reads the finished results, including Spiral Time's, with sources. |

Every Spiral Time includes a **security news check**: breaches, stolen keys, distrusted certificate authorities,
poisoned packages and hijacked accounts that could affect HARMONY or your accounts. About once a week it also includes a
**model scan**: newer, faster models on GitHub and Hugging Face that fit a GTX 1650.

About once a week it also includes the **remote job scout**: well-paid remote roles that fit your profile, ranked,
with a cover letter for the best. Say **"find me remote jobs"** to send it on the next Spiral Time anyway, and **"any
remote jobs?"** to hear the top three. Everything is in the Jobs panel (◇), where you can edit the profile Claude scouts
with. That profile is the only personal text in the ticket, so keep it to what a résumé would say. Nobody applies for
you: you open the posting and send the letter yourself.

## How the handoff works

Everything lives in `handoff/` in the HARMONY folder. It's local only and ignored by git.

1. `ticket.json` is written by HARMONY. It holds a random ticket id, the jobs (id, kind, text) and when it expires
   (7 AM).
2. A Claude scheduled task looks for a ticket once an hour, from 9 PM to 2 AM. With no ticket, it stops at once.
   `working.json` stops two runs from overlapping.
3. Claude works one job at a time. Each result goes to `inbox/<job id>.json` as soon as it's finished, so nothing done
   is lost when the limit hits:
   `{"v":1,"ticket":"t-…","job":"…","summary":"…","report":"…","sources":[{"title":"…","url":"https://…"}]}`
   (a job-scout result also carries `"leads"` and `"letter"`)
4. When every job is done, the ticket is renamed `finished-<ticket id>.json`.
5. HARMONY checks the inbox every 5 minutes. She imports a result only when it's for a ticket she wrote and a job she
   issued, once per job, as plain text with web links. Tool markup is stripped. Anything else goes to `rejected/`, and
   imported files go to `done/`.

## Safety and cost

- Only you can start it. It's an action, so voices HARMONY doesn't recognize get guest mode and can't.
- Claude's runs only research and write into `handoff/`: no code changes, no messages, no purchases, no deleting.
  Results are only information; nothing in a result can make HARMONY do something.
- Runs count against your Claude plan. Checks with no ticket end immediately. To make sure nothing can bill past your
  plan, keep **extra usage** turned off in your Claude settings.
- The jobs' text goes to Claude. Don't save private things for Spiral Time.
