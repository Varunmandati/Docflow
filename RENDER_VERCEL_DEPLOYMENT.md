# Deploying DocFlow for Free (Render + Vercel)

This architecture lets you deploy the full document conversion engine, torrent proxy, and React frontend absolutely free of charge.

## Architecture

Your application is split into two physical locations:
1.  **Frontend (React/Vite)**: Deployed to **Vercel** ($0/month).
2.  **Backend (API + Worker + Streamtor)**: Deployed to **Render's Free Web Service** ($0/month).

To power the application state and conversion queue without paying for Render's expensive persistent databases, we use external serverless database providers.

## Step 1: Provision Free Databases
Before touching Render or Vercel, you need database connection strings.

1.  **PostgreSQL (Neon)**:
    *   Go to **neon.tech** and create a free project.
    *   Copy the connection string. It will look like: `postgresql://user:password@hostname/dbname?sslmode=require`
2.  **Redis (Upstash)**:
    *   Go to **upstash.com** and create a core Redis database.
    *   Scroll down to find your `REDIS_URL` in the Node.js connection tab. It will look like: `rediss://default:password@hostname:port`

## Step 2: Deploy the Backend to Render

Our root `Dockerfile` has been optimized to do all the heavy lifting in a single free container. It installs LibreOffice, Python OCR tools, dependencies, and runs both the Fastify API (with an inline queue worker) and the Streamtor proxy simultaneously using `concurrently`.

1.  Create an account on **Render.com**.
2.  Click **New -> Web Service**.
3.  Select **Build and deploy from a Git repository**.
4.  Connect your GitHub account and select the DocFlow repository.
5.  **Settings**:
    *   **Name**: `docflow-backend`
    *   **Region**: Pick the one closest to you.
    *   **Branch**: `main`
    *   **Language Environment**: **Docker** 
    *   **Instance Type**: **Free** ($0/month)
6.  **Environment Variables (Crucial)**:
    *   `DATABASE_URL`: *<Your Neon URL>*
    *   `DATABASE_URL_WORKER`: *<Your Neon URL>*
    *   `REDIS_URL`: *<Your Upstash URL>*
    *   `RUN_INLINE_WORKERS`: `true` *(This is vital. It forces the Queue Worker to run inside the API process, saving you from needing a paid Render Background Worker plan)*
    *   `STREAMTOR_INTERNAL_URL`: `http://127.0.0.1:3002`
    *   `PORT`: `8080`
    *   `CORS_ORIGIN`: `*` *(Or your future Vercel domain)*
    *   *Add any Firebase or SMTP variables (`SMTP_HOST`, `SMTP_USER`, etc.) required by your `.env`.*
7.  Click **Deploy**.
    > **Note:** The first build will take ~10 minutes because it compiles LibreOffice, Python, and Ghostscript.

## Step 3: Deploy the Frontend to Vercel

1.  Create an account on **Vercel.com**.
2.  Click **Add New -> Project**.
3.  Import the DocFlow repository.
4.  Vercel will auto-detect the Vite framework.
5.  **Environment Variables**:
    *   `VITE_API_URL`: Use your new Render backend URL (e.g., `https://docflow-backend.onrender.com`).
    *   *Add any `VITE_FIREBASE_*` config parameters needed.*
6.  Click **Deploy**.

## 💡 Important Notes on Free Tiers

*   **Render Cold Starts**: Render's free tier spins down your application after 15 minutes of inactivity. When you (or a user) make the next request, the API will take **~30-50 seconds** to wake up. This is a known trade-off for free hosting.
*   **Memory Constraints**: The Render Free Web Service has 512MB RAM. LibreOffice is memory intensive. Extremely large PPTX or DOCX files might cause the Render container to crash with an Out-of-Memory (OOM) error. If this happens frequently, you may eventually need to upgrade the Render tier to 1GB RAM ($15/mo) or use Fly.io's Hobby tier.
*   **Persistent Storage**: Render free tier disk space is ephemeral (deleted on restarts). This is fine for DocFlow since it only needs temporary disk space during the conversion process before streaming the output back to the client!