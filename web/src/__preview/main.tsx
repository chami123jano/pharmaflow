/** Preview entry: renders each page at phone width so it can be looked at. */
import { createRoot } from 'react-dom/client';
import Today from '../routes/Today';
import Reports from '../routes/Reports';
import Products from '../routes/Products';
import Stock from '../routes/Stock';
import { AuthProvider } from '../lib/auth';
import '../index.css';

const PAGES: Record<string, () => JSX.Element> = { today: Today, reports: Reports, products: Products, stock: Stock };
const which = new URLSearchParams(location.search).get('p') || 'today';
const Page = PAGES[which] || Today;

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <div className="mx-auto max-w-3xl px-4 py-5">
      <Page />
    </div>
  </AuthProvider>
);
