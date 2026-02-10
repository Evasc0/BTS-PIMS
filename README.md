
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
  