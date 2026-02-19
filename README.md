
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

### Supabase Automatic Sync Setup (Role-Based)

This app keeps SQLite as the main database and uses Supabase for:
- Auth + centralized user metadata (`app_users`)
- Temporary sync queue storage for operational data

1. Create `.env` in the project root (or copy from `.env.example`):

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
# optional alias:
# SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_ADMIN_QUEUE_TABLE=admin_sync_queue
SUPABASE_EMPLOYEE_QUEUE_TABLE=employee_sync_queue
SUPABASE_FULL_SYNC_REQUESTS_TABLE=full_sync_requests
SUPABASE_FULL_SYNC_CHUNKS_TABLE=full_sync_chunks
SUPABASE_FULL_SYNC_STORAGE_BUCKET=full-sync-temp
SUPABASE_APP_USERS_TABLE=app_users
SYNC_PUSH_BATCH_SIZE=500
SYNC_PULL_PAGE_SIZE=200
SYNC_QUEUE_RETENTION_DAYS=2
SYNC_MAX_OFFLINE_DAYS=7
SYNC_TARGET_STALE_DAYS=3
SYNC_DELETE_RETRY_ATTEMPTS=3
SYNC_FULL_CHUNK_MB=5
SYNC_RELAY_DB_LIMIT_MB=500
SYNC_RELAY_STORAGE_LIMIT_MB=1024
SYNC_RELAY_DB_SOFT_THRESHOLD=0.7
SYNC_RELAY_DB_HARD_THRESHOLD=0.85
SYNC_RELAY_STORAGE_SOFT_THRESHOLD=0.7
SYNC_RELAY_STORAGE_HARD_THRESHOLD=0.85
SYNC_RELAY_HARD_STOP_MIN_FREE_MB=25
SYNC_RETENTION_RPC_COOLDOWN_MS=14400000
SYNC_ORPHAN_OBJECT_RETENTION_DAYS=2
SYNC_ORPHAN_OBJECT_CLEANUP_LIMIT=1000
AUTH_VERIFICATION_DAYS=30
VITE_SYNC_REALTIME_POLL_MS=60000
VITE_SYNC_IDLE_AFTER_MS=300000
VITE_SYNC_IDLE_POLL_MS=60000
```

2. In Supabase SQL Editor, run:
- `supabase/role_based_sync.sql`

This creates:
- `app_users` for Supabase identity metadata (role/status/employee mapping)
- `admin_sync_queue` for global system-admin changes
- `employee_sync_queue` for assigned employee updates
- `full_sync_requests` for stale-device full-sync approval workflow
- `full_sync_chunks` for chunk metadata (5MB max/chunk)
- indexes + RLS policies
- `cleanup_sync_queues()` 48-hour queue retention function + 6-hour scheduler (pg_cron)
- `cleanup_full_sync_requests()` retention cleanup for old full-sync sessions + orphan storage objects
- `sync_relay_usage_stats()` quota telemetry RPC

3. Sync controls:
- System admin and employee devices auto-sync when authenticated and online (push + pull loop every ~30s).
- Sync loop automatically switches sync mode offline after inactivity (`VITE_SYNC_IDLE_AFTER_MS`, default 5 minutes) and wakes online immediately on user activity.
- Employee and admin UI are automatic-only for normal push/pull (no manual sync buttons or online/offline toggle).
- Admin retains `Full Sync Check` only for controlled full-sync approval.

4. RLS note:
- Strict RLS requires authenticated Supabase JWTs with claims (`app_role`, `employee_id`).
- If you only use a publishable/anon key without JWT auth, strict RLS will block requests (development fallback is included in `supabase/role_based_sync.sql` as commented lines).

5. Queue safety rules:
- Pulled records are deleted immediately after successful local apply.
- Pull deletion retries automatically if Supabase delete fails.
- Queue writes are conflict-safe upserts (`recipient_key + table_name + record_id`) to prevent relay duplicates.
- Push is automatically deferred when relay usage approaches configured hard thresholds.
- Stale recipient targets (no recent activity) are skipped to avoid indefinite queue growth.
- Records older than 48 hours are purged from queue via scheduled cleanup.
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

6. Controlled Full Sync (new admin device onboarding):
- Requests are tracked in `full_sync_requests` and include `requesting_device_id`, `target_device_id`, `requested_by`, `estimated_records`, `estimated_size_mb`, and `created_at` (plus legacy compatibility fields).
- Admin uses `Full Sync Check` to find pending requests targeted to the current device and approve/reject.
- Approved full sync runs in chunked batches (`SYNC_FULL_CHUNK_MB`, max 5MB) with transactional local apply.
- Chunks are validated (size + SHA256) before apply, then relay rows/objects are cleaned up.
- When all chunks are acknowledged, the requester rebuilds inventory tables locally and clears the full-sync lock.
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
  
