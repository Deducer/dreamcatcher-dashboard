# DreamCatcher Dashboard

A lightweight analytics dashboard for DreamCatcher, built with Node.js, Express,
and Supabase.

## Features

- **Secure Access**: Simple password authentication.
- **Real-time Stats**: Connects directly to Supabase to fetch latest data.
- **Visualizations**: Charts for emotions, tags, recording methods, and activity
  trends.
- **Dockerized**: Ready for easy deployment on Coolify.

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment** Create a `.env` file (copy from `.env.example`) and
   fill in your Supabase credentials and choose a dashboard password.
   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_KEY=...
   DASHBOARD_PASSWORD=...
   ```

3. **Run Locally**
   ```bash
   npm run dev
   ```

4. **Deploy with Docker** (local / manual)
   ```bash
   docker build -t dreamcatcher-dashboard .
   docker run -p 3000:3000 --env-file .env dreamcatcher-dashboard
   ```

## Deployment (production)

- **Host:** Coolify, serving `https://dreamverse.dissonance.cloud`.
- **Source:** Coolify builds the Docker image from the `main` branch of this
  GitHub repo (`github.com/Deducer/dreamcatcher-dashboard`).
- **Trigger:** pushing to `main` auto-deploys via a Coolify webhook. A commit
  that is only committed locally is **not** live — it must be pushed. A manual
  redeploy can also be triggered from the Coolify dashboard.
- **Env vars** (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DASHBOARD_PASSWORD`)
  are configured in Coolify, not committed.
- **Metrics latency:** internal-account exclusion reads the Supabase
  `auth.users` email map, cached in-process for 5 minutes. After a deploy,
  metric/exclusion changes can take up to that long to fully reflect.
