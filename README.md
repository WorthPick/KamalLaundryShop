# Kamal Power Laundry

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** and run [`supabase-schema.sql`](supabase-schema.sql).
3. In **Authentication > Users**, create the shop owner account with the email and password the owner will use.
4. Copy `.env.example` to `.env` and fill in the Supabase URL, anon key, service-role key, owner email, and a long session secret.
5. Run:

```powershell
npm install
npm start
```

6. Open `http://localhost:3000`.

The browser never receives the service-role key. The Node server uses Supabase Auth for login and the service-role client for protected database operations. The `users` table is a profile table linked to `auth.users`; passwords are stored and verified by Supabase Auth, not in the application tables.

For deployment, use a Node-compatible host, set the same environment variables in its secret manager, and use HTTPS so the session cookie remains secure.
