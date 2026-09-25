import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './lib/auth';
import './index.css';
import { SHOP_NAME } from './lib/shop';

// The title is in the HTML for the first paint; correct it for this shop.
document.title = SHOP_NAME;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
