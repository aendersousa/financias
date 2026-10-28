Daily maintenance generates recurring Agenda items, advances card cycles,
settles linked provisions, processes reserve funding and refreshes notifications.
The SQL RPC accepts only the backend service role. The Edge endpoint accepts
only POST requests with an `x-maintenance-secret` matching the server secret.

Deployment has not been performed. To activate this endpoint, a project
administrator must deploy `daily-maintenance` with JWT gateway verification
disabled (`supabase functions deploy daily-maintenance --no-verify-jwt`), set
`DAILY_MAINTENANCE_SECRET` to a random secret of at least 32 characters, and
configure a backend scheduler to POST to the deployed endpoint every 15 minutes.
Pass the secret in `x-maintenance-secret`. Keep both that secret and the service
role key on the server. The app must never receive either credential.

The notification collector enforces the space timezone: date alerts begin at
08:00, and main-income questions at 09:00. Repeated runs keep the same deduplication
keys. State alerts resolve when the condition ends. Push delivery, push quiet
hours and security email delivery require separate providers and remain pending.
