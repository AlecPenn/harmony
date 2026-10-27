# Your private profile

Anything personal that HARMONY needs as a default lives in `data/profile.json`. The whole `data` folder is ignored by
git, so it never ends up in the code or on GitHub. If the file is missing, the features that need it stay off.

Today it holds the job scout's résumé (the only personal text Spiral Time sends to Claude, with secrets masked):

```json
{
  "job": {
    "name": "Your Name",
    "wants": "The kind of remote roles you want",
    "experience": "What you've done, in a few sentences",
    "skills": "What you're good at",
    "minPay": "$70,000 a year, or $35 an hour",
    "avoid": "Commission-only, unpaid trials, pay to apply",
    "enabled": true
  }
}
```

You can also edit it in the app (Settings, Jobs); what you save there takes priority. Email reply drafts are signed
with the `name` here.

Things you ask HARMONY to remember ("remember that I live in...") are stored in her database, also inside `data`.
