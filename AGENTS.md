<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Setting up jobahn (for AI coding agents)

When the user asks you to set up, install or run jobahn, follow these steps in order. Explain each step in plain language; the user may not be a developer. `README.md` has the same steps for humans.

## Steps you can do yourself

1. Check `node -v` is 20 or higher. If not, tell the user how to install Node.js and stop until they have.
2. Run `npm install`.
3. If `.env.local` doesn't exist, copy `.env.local.example` to `.env.local`.
4. Ask which AI provider they want:
   - **Claude subscription** (`AI_PROVIDER=local-cli`, the default): check that `claude -p "reply with ok"` prints a reply. If it fails, ask them to run `claude` once and log in.
   - **Anthropic API key** (`AI_PROVIDER=api`): ask them to paste the key and write it to `ANTHROPIC_API_KEY`.

## Steps the user must do (walk them through one at a time, wait for each to finish)

5. **Create a Supabase project** at https://supabase.com (free plan is fine).
6. **Create the tables.** Copy all migrations to their clipboard yourself, in order:
   - macOS: `cat supabase/migrations/*.sql | pbcopy`
   - Linux: `cat supabase/migrations/*.sql | xclip -selection clipboard`
   - Windows PowerShell: `Get-Content supabase\migrations\*.sql | Set-Clipboard`

   Then tell them: open **SQL Editor** in the Supabase dashboard, paste, click **Run**, and confirm if it warns about destructive operations (migration `0006` drops an unused storage bucket). Success looks like "Success. No rows returned".
7. **Turn off email confirmation**: **Authentication → Sign In / Providers → Email → Confirm email** off. Supabase's built-in mailer is rate-limited, so confirmation emails often never arrive.
8. **Get the keys** and write them into `.env.local` yourself:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://<project-id>.supabase.co` (project ID is in the dashboard address bar).
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: **Project Settings → API Keys → Publishable key** (`sb_publishable_...`), or the legacy `anon` key.
   - `SUPABASE_SERVICE_ROLE_KEY`: same page, **Secret key** (`sb_secret_...`), or the legacy `service_role` key. This key bypasses all row-level security: never echo it back, never put it anywhere except `.env.local` (which is gitignored).
   - `FIRECRAWL_API_KEY` is optional; skip it unless they want job-URL scraping and company research.

## Verify

9. Check the database: `curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/profiles?select=id&limit=1" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"` should return HTTP 200 with `[]`.
   - `PGRST205` / "Could not find the table": the migrations weren't run (step 6).
   - `Could not resolve host`: wrong URL, or the project is paused (free projects pause after a week without activity; **Restore project** in the dashboard).
   - `Invalid API key`: the key in `.env.local` is wrong or has quotes/spaces around it.
10. Run `npm run dev` and confirm http://localhost:3000 responds.
11. Tell the user to open http://localhost:3000 and sign up. They should land on the app logged in. If they're told to check their email instead, step 7 wasn't done.

## Troubleshooting

- SQL error "Direct deletion from storage tables is not allowed": their copy of `0006` is outdated. `git pull`, then run only `0006` and `0007` (the earlier files already succeeded and are not safe to re-run).
- Don't edit migration files or app code to work around a setup problem. Setup issues are almost always a missing step above.
