# Kapfi Equity Broker Portal CRM

This is a real role-based CRM portal with backend permissions:

- `Admin` can invite brokers with signup links, create deals, assign/reassign deals, and move deal stages.
- `Broker` can only log in and view deals assigned to them.
- Brokers cannot see each other's deals.
- Offer details (`offer amount`, `term value`, `term unit daily/weekly`, `factor rate`) are required at `Offer or Declined` stage and beyond.

## Stack

- Node.js + Express
- SQLite (`better-sqlite3`)
- JWT auth
- Password hashing with `bcryptjs`

## Important Routes

- Login: `/login.html`
- Broker signup (invite link): `/signup.html?token=...`
- Admin portal: `/admin.html`
- Broker portal: `/broker.html`

## First Admin Login

When the app starts first time, it auto-creates:

- Email: `admin@kapfi.co`
- Password: `ChangeMe123!`

Change this in production by setting environment variables:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `JWT_SECRET`

## Local Run

1. Install Node.js (LTS)
2. In project folder, run:
   - `npm install`
   - `npm start`
3. Open: `http://localhost:3000/login.html`

## Deploy (Backend Required)

Because this project has a backend, use a Node host (Render, Railway, Fly.io, or similar).
Static-only Vercel deployment is not enough for login/database unless you rewrite into serverless architecture.

## Core Permission Rules Implemented

- Admin can see all deals.
- Broker sees only deals where `deals.broker_id = broker_user_id`.
- Only admin routes can invite brokers, create deals, assign deals, or move stage.

## Database File

- SQLite file: `kapfi.db`
- It is auto-created on first run.
