import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './lib/auth';
import { applyThemePreference, getStoredThemePreference } from './lib/theme';

applyThemePreference(getStoredThemePreference());

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
