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

4. **Deploy with Docker**
   ```bash
   docker build -t dreamcatcher-dashboard .
   docker run -p 3000:3000 --env-file .env dreamcatcher-dashboard
   ```
