# MedShifter production release

The public site is served by Nginx from `/var/www/medshifter`; the Express API
runs behind `/api` on port 3002. GitHub pushes do not deploy this VPS by
themselves.

## Emergency security step

The production Nginx file is `/etc/nginx/sites-enabled/medshifter`. It now
blocks `/server/`, dotfiles, `nginx.conf`, and `create-test-users.js`. Preserve
its existing port 3002 proxy and TLS settings when editing it; do not replace
it wholesale with the repository's example `nginx.conf`. Check the effective
configuration, reload it, then verify all four requests return 404:

```sh
sudo nginx -t && sudo systemctl reload nginx
curl -I https://medshifter.app/server/.env
curl -I https://medshifter.app/server/src/index.js
curl -I https://medshifter.app/.git/config
curl -I https://medshifter.app/nginx.conf
```

Treat values in the exposed `.env` as compromised. Rotate at least the Supabase
service role key, `ADMIN_JWT_SECRET`, PayTR merchant key/salt, and Gemini key if
present. Update the VPS environment and restart the API. Supabase service role
rotation can invalidate integrations that still use the old key; coordinate
the change in its dashboard. Do not put secret values in Git or shell history.

## Authentication configuration

- Supabase Google provider must remain enabled.
- In Google Cloud OAuth, the authorized redirect URI is
  `https://hkoicikmwbkbmwxbpxth.supabase.co/auth/v1/callback`.
- In Supabase Auth URL Configuration, allow the site URL
  `https://medshifter.app` and the redirect URL
  `https://medshifter.app/login.html?redirect=app.html`.
- Keep email signup enabled and verify that confirmation mail can be delivered.

## Release checks

```sh
git -C /var/www/medshifter pull --ff-only origin main
cd /var/www/medshifter/server
npm ci --omit=dev
npm test
pm2 restart medshifter
curl -f https://medshifter.app/api/health
curl -f https://medshifter.app/api/ready
```

After deploying the static files, test Google signup with a fresh account,
email confirmation, sign out and sign in, schedule creation, cloud save/load,
and share/revoke in a clean browser profile. Confirm a new user gets a profile
and the expected FREE plan limits. Never test the payment flow with a real
charge unless a separate payment test environment is configured.
