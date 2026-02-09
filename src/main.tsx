
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './lib/auth';

function SyncBridge() {
  useEffect(() => {
    if (!window.api?.sync?.trigger) return undefined;
    window.api.sync.trigger();
    const handleOnline = () => window.api?.sync?.trigger();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <SyncBridge />
    <App />
  </AuthProvider>
);
  
