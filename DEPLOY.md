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
| `SESSION_SECRET` | a long random string (64+ characters). Changing it signs you out. |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | from the R2 API token |
| `R2_SECRET_ACCESS_KEY` | from the R2 API token |
| `R2_BUCKET` | the bucket name |

`PORT` is set by Railway.

## 4. Domain
App service → **Settings → Networking → Generate Domain** (or add a custom domain). HTTPS is required: the session cookie is `Secure`.

## 5. First run
Open the site. A fresh database shows **Set up SteelBuild Pro TopOut**: enter your name, email and a password (10+ characters). That account is the owner and the only login. Then add crew under **Settings → Crew**, companies, equipment, and your first job.

## Forgot the password
Set `OWNER_RESET_PASSWORD` to a new password (10+ characters) and redeploy. On startup the owner password is replaced and the log says `[auth] owner password reset from OWNER_RESET_PASSWORD`. Sign in, then **remove the variable**.

## Files
Drawings, documents, receipts and photos are stored in R2 and served at `/files/…` only to the signed-in owner, via 5-minute signed links.
