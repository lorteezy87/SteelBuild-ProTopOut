# Workel patterns, steps 1-4

Four structural patterns taken from a teardown of Workel (a generic task workspace) and
rebuilt for TopOut. No Workel code was used; these are common SaaS patterns observed from
its public site and UI.

## What shipped

| Step | Pattern | Server | Client |
| --- | --- | --- | --- |
| 1 | View state stored per user | `user_view_prefs` table, `prefs.get/set/reset`, rules in `shared/viewPrefs.ts` | `useViewPref` hook in `client/src/lib/viewPrefs.ts`; Jobs list filters and sort use it |
| 2 | Shell counts on their own cheap query | `shell.counts` (two aggregate queries), shaping in `shared/shell.ts` | Nav rail badges: Today = log items past due, Jobs = active jobs delayed, Logs = ball in our court |
| 3 | Short ids and slugs in job URLs | `projects.publicId` (unique, 8 chars), `projects.locate`, helpers in `shared/jobUrl.ts` | Canonical `/j/{publicId}/{slug}/{tab}`; `/jobs/{id}/...` still works and is replaced in the address bar |
| 4 | Job tab registry | `job_tabs` table, `jobTabs.list/save/reset`, registry in `shared/jobTabs.ts` | Job tab bar reads the job's layout; "Tabs" button opens a reorder / rename / hide dialog |

## Decisions

- **View prefs are never trusted whole.** `mergeViewPref` keeps only keys the screen still
  declares and only when the stored kind matches the default, so a pref written by an older
  build cannot break a screen. Values are capped at 16 KB.
- **Public ids avoid vowels and look-alike characters** so they cannot spell words and read
  back cleanly over the phone. The slug is decoration and is never used for lookup.
- **`projects.locate` answers NOT_FOUND for a job the caller cannot see**, the same as for an
  unknown id, so a URL cannot be used to probe which jobs exist.
- **A job with the default tabs stores no rows.** It keeps following the registry, so a tab
  added to the product later appears on it. Customized jobs get new tabs appended.
- **Tab layout belongs to the job, not the user.** Changing it needs `project.edit`.
- **Hiding a tab only removes it from the bar.** Its data is untouched and a direct link
  still opens it.
- **Overview cannot be hidden.**
- Existing `/jobs/${id}` links across the client were left alone; they resolve through the
  redirect. Move them to `jobPath()` from `shared/jobUrl.ts` as files are touched.

## Migration `0012_workel_patterns`

Creates `job_tabs` and `user_view_prefs`, and adds `projects.publicId`: added nullable,
backfilled with 8 random characters per row, then set NOT NULL and UNIQUE.
`start:railway` runs migrations on boot, so deploying this branch applies it.

Not run against a live MySQL in development (none was available). Run it on a copy of
production first.

## Not done (steps 5-6 of the spec)

- AI proposal queue (draft, then approve)
- Scheduled assistant routines
