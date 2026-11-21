# Deploying SteelBuild Pro TopOut

TopOut is one Node service plus a MySQL 8 database and a Cloudflare R2 bucket. Railway is the reference host.

## 1. Railway project
1. Create a new Railway project for TopOut (keep it separate from any other app).
2. **+ New → Database → MySQL.**
3. **+ New → GitHub Repo →** `lorteezy87/SteelBuild-ProTopOut`. Railway reads `railway.json`: it builds the `Dockerfile`, starts with `pnpm start:railway` (applies migrations, then serves) and health-checks `/api/health`.

## 2. Cloudflare R2
1. Cloudflare dashboard → R2 → **Create bucket** (for example `topout-files`). Keep it private.
2. R2 → **Manage API tokens → Create API token** with *Object Read & Write* on that bucket. Copy the Access Key ID and Secret Access Key.
3. Your Account ID is on the R2 overview page.

## 3. Variables (app service → Variables)
| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` |
| `SESSION_SECRET` | a long random string (at least 32 characters; 64 recommended). The server will not start without it. Changing it signs you out. |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | from the R2 API token |
| `R2_SECRET_ACCESS_KEY` | from the R2 API token |
| `R2_BUCKET` | the bucket name |

`PORT` is set by Railway. Do **not** set `R2_ENDPOINT` or `NWS_BASE_URL` in production (they exist for local testing). Weather needs no key: the server calls api.weather.gov directly.

Updates: every deploy runs `drizzle-kit migrate` before the server starts, so new tables and columns (Phase 2 adds migrations 0001–0004, Phase 3 adds 0005–0009, Phase 4 adds 0010–0011) apply automatically.

## 4. Domain
App service → **Settings → Networking → Generate Domain** (or add a custom domain). HTTPS is required: the session cookie is `Secure`.

## 5. First run
Open the site. A fresh database shows **Set up SteelBuild Pro TopOut**: enter your name, email and a password (10+ characters). That account is the owner and the only login. Then add crew under **Settings → Crew**, companies, equipment, and your first job.

## Forgot the password
Set `OWNER_RESET_PASSWORD` to a new password (10+ characters) and redeploy. On startup the owner password is replaced and the log says `[auth] owner password reset from OWNER_RESET_PASSWORD`. Sign in, then **remove the variable**.

## Files
Drawings, documents, receipts and photos are stored in R2 and served at `/files/…` only to the signed-in owner, via 5-minute signed links.

## Offline use (tablets)
The app installs a service worker the first time it's opened over HTTPS, so open each tablet's browser on the app once while online and sign in. After a deploy, a device picks up the new version the next time it's online. Saves made offline on the old version still sync.
