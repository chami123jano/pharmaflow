import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { ShopProvider } from './lib/shop';
// Bundled into the app rather than fetched: the till has to look right with
// no internet, and a missing web font falls back to whatever Windows has.
import '@fontsource-variable/inter';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <HashRouter>
        <ShopProvider>
          <App />
        </ShopProvider>
      </HashRouter>
    </AuthProvider>
  </React.StrictMode>
);
