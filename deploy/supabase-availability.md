# Supabase availability

Supabase Free projects can pause after a week with too little database activity. A paused project hostname stops resolving, so email and Google sign-in both fail with a network error. Restore a paused project from its Supabase dashboard before enabling the timer.

The VPS timer queries the `profiles` table every eight hours using the server's existing service role key. It prints only success or a short error; it does not print credentials or profile data. GitHub's scheduled workflow is a secondary check because GitHub can disable it after 60 days without repository activity.

Install after deploying the current repository version:

```sh
install -m 644 deploy/medshifter-supabase-keepalive.service /etc/systemd/system/
install -m 644 deploy/medshifter-supabase-keepalive.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now medshifter-supabase-keepalive.timer
systemctl start medshifter-supabase-keepalive.service
systemctl status medshifter-supabase-keepalive.service --no-pager
systemctl list-timers medshifter-supabase-keepalive.timer --no-pager
```

A successful run confirms the database answered. Check failures with `journalctl -u medshifter-supabase-keepalive.service -n 30 --no-pager`.
