# Optional DeepL provider for POI Description

`POI_DESCRIPTION_PROVIDER` changes only automatic POI Description translation, including
its back translation. Narration still uses `TRANSLATION_PROVIDER=libretranslate`.
The default is `libretranslate`. Changing this setting does not overwrite existing
current-source translations; use a reviewed, single-POI retry when needed.

To deliberately enable DeepL on a confirmed free API account, set these in the
ignored local `.env` file. Do not put the key in a command, tracked file or log.

```text
POI_DESCRIPTION_PROVIDER=deepl
DEEPL_ACCOUNT_PLAN=developer
DEEPL_API_ENDPOINT=https://api-free.deepl.com/v2/translate
DEEPL_API_KEY=<existing key>
DEEPL_REMAINING_CHARACTERS=<current remaining allowance from the DeepL account>
DEEPL_MAX_RUN_CHARACTERS=<small per-translation-operation cap including back translation>
DEEPL_PRODUCTION_CONFIRMED=true
```

The endpoint is fixed to `api-free.deepl.com`; paid endpoints and unknown plans
are rejected. Both the per-operation cap and an in-process allowance are reserved
before each request, including requests that fail. The in-process counter resets
on server restart and cannot track other server instances or benchmark usage.
Refresh the remaining allowance from the DeepL account before enabling it. The
free account's own quota is the final external limit; HTTP 456 stops the job.
Do not send content that the account terms prohibit. The adapter makes no
automatic switch to a paid endpoint or to another provider.

Preview one Description without a translation API call or SQL write:
The tool first checks `SELECT DB_NAME()` and requires `AutoNarrationDB`.

```powershell
node scripts/review-poi-description-quality.js --id=904e5832-5d53-4bb2-8337-ccab5fab7f2d --lang=en --field=description
```

The output contains the current source hash, saved source and Description hashes,
status, planned columns, and a plan hash. A future explicit retry requires the
same ID, language, field and returned plan hash:

```powershell
node scripts/review-poi-description-quality.js --id=<same-id> --lang=en --field=description --retry=<reviewed-plan-hash>
```

Retry writes only `POITranslations.Description` and `DescriptionSourceHash` for
the selected language, or inserts a Description-only row if absent. It does not
modify Name, Address, Narration or WAV. A changed source or translation invalidates
the plan. A current safe `displayable:unverified:v1` result has no retry action,
so repeating a reviewed command does not spend characters again. The normal
Admin POI update already enqueues a translation job; the API
falls back while the old Description hash is stale. Quality status remains
`unverified` when `verified:v2` has insufficient evidence, even if the public
display gate allows the translation.
