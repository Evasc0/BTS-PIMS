
# BTS Inventory Management System

A comprehensive inventory management system built with Electron, React, TypeScript, and SQLite. This application provides features for managing employees, products, returns, activity logs, and system settings with a modern UI.

## Prerequisites

- Node.js (version 18 or higher)
- npm (comes with Node.js)

## Dependencies

The project uses npm for dependency management. All dependencies are listed in `package.json`. Key dependencies include:

### Frontend
- React 18.3.1
- TypeScript 5.5.4
- Tailwind CSS (via PostCSS)
- Radix UI components (various)
- Lucide React (icons)
- Recharts (charts)
- React Hook Form (forms)

### Backend / Electron
- Electron 31.6.0
- better-sqlite3 11.7.0 (SQLite database)
- Various build tools (Vite, Electron Builder)

To view all dependencies, check the `package.json` file or run:

```bash
npm list --depth=0
```

## Getting Started

### Cloning the Repository

```bash
git clone <repository-url>
cd bts-inventory-management-system
```

### Installing Dependencies

After cloning the repository, install the required dependencies:

```bash
npm install
```

This command will also install Electron app dependencies automatically via the postinstall script.

### Running in Development Mode

To start the application in development mode:

```bash
npm run dev
```

This will:
- Start the Vite development server for the React frontend
- Compile the Electron main process
- Launch the Electron application

The application will open in a new window. The development server supports hot reloading for the frontend.

### Supabase Manual Sync Setup (Role-Based)

This app keeps SQLite as the main database and uses Supabase for:
- Auth + centralized user metadata (`app_users`)
- Temporary sync queue storage for operational data

1. Create `.env` in the project root (or copy from `.env.example`):

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
# optional alias:
# SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
# required for admin-managed auth updates (reset password / update email for other users):
SUPABASE_SERVICE_ROLE_KEY=sb_service_role_xxx
SUPABASE_ADMIN_QUEUE_TABLE=admin_sync_queue
SUPABASE_EMPLOYEE_QUEUE_TABLE=employee_sync_queue
SUPABASE_FULL_SYNC_REQUESTS_TABLE=admin_sync_requests
SUPABASE_FULL_SYNC_CHUNKS_TABLE=admin_full_sync_temp
SUPABASE_FULL_SYNC_STORAGE_BUCKET=full-sync-temp
SUPABASE_APP_USERS_TABLE=app_users
SYNC_PUSH_BATCH_SIZE=100
SYNC_PULL_PAGE_SIZE=200
SYNC_QUEUE_RETENTION_DAYS=7
SYNC_MAX_OFFLINE_DAYS=7
SYNC_DELETE_RETRY_ATTEMPTS=3
SYNC_FULL_CHUNK_MB=5
SYNC_FULL_CHUNK_RECORDS=75
AUTH_VERIFICATION_DAYS=30
```

2. In Supabase SQL Editor, run:
- `supabase/role_based_sync.sql`

This creates:
- `app_users` for Supabase identity metadata (role/status/employee mapping)
- `admin_sync_queue` for global system-admin changes
- `employee_sync_queue` for assigned employee updates
- `admin_sync_requests` for admin-to-admin full-sync request/approval workflow
- `admin_full_sync_temp` for chunk transfer metadata
- indexes + RLS policies
- `cleanup_sync_queues()` 7-day queue retention function + daily scheduler (pg_cron)
- `cleanup_full_sync_requests()` retention cleanup for old full-sync sessions

3. Sync controls:
- System admin settings: `Go Online / Offline`, `Push Local Changes`, `Pull Remote Changes`
- Employee: assigned pulls only (no global push)

4. RLS note:
- Strict RLS requires authenticated Supabase JWTs with claims (`app_role`, `employee_id`).
- If you only use a publishable/anon key without JWT auth, strict RLS will block requests (development fallback is included in `supabase/role_based_sync.sql` as commented lines).

5. Queue safety rules:
- Pulled records are deleted immediately after successful local apply.
- Pull deletion retries automatically if Supabase delete fails.
- Records older than 7 days are purged from queue (daily job + system-admin-side fallback cleanup on sync actions).
- If a device has been offline beyond `SYNC_MAX_OFFLINE_DAYS`, push/pull is blocked and `Full Sync Required` is enforced.
- `activity_logs` are local-only and never pushed to Supabase.

### Offline-First Authentication

- First login on a device requires internet and Supabase credential verification.
- Successful online verification caches:
  - `last_verified_at`
  - `verification_expires_at` (`AUTH_VERIFICATION_DAYS`, default 30)
  - `hashed_session_token` (no plain token stored in SQLite)
- Subsequent offline login is allowed while verification is still valid and account status is active.
- When verification expires, login is blocked until online verification succeeds.
- User creation is instant and online-only from a signed-in `system_admin` session (no delayed queue for user provisioning).

6. Controlled Full Sync (admin-to-admin):
- Requesting admin creates an `admin_sync_requests` row (`pending`) from Settings.
- Co-admin approves/rejects requests from Settings.
- Both admins must confirm stable internet before transfer starts.
- Approving admin uploads one chunk at a time (`SYNC_FULL_CHUNK_MB`, `SYNC_FULL_CHUNK_RECORDS`) to Supabase Storage bucket.
- Requesting admin pulls next chunk, verifies size + SHA256, acknowledges, then pulls next.
- When all chunks are acknowledged, the requesting admin rebuilds inventory tables locally and clears full-sync lock.
- Full sync export excludes `activity_logs` and other non-inventory tables.

### Building for Production

To build the application for production:

```bash
npm run build
npm run dist
```

This will create distributable packages in the `dist` directory.

## Project Structure

- `src/`: React frontend components and utilities
- `electron/`: Electron main process and IPC handlers
- `electron/db/`: Database schema, migrations, and data access layer
- `scripts/`: Build and utility scripts

## Features

- Employee management
- Product inventory tracking
- Return processing
- Activity logging
- System settings and configuration
- Responsive UI with dark/light theme support

## Technologies Used

- **Frontend**: React, TypeScript, Tailwind CSS, Radix UI
- **Backend**: Electron, Node.js
- **Database**: SQLite with better-sqlite3
- **Build Tools**: Vite, Electron Builder
  
