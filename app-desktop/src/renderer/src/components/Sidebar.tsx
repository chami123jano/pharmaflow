import React from 'react';
import { NavLink } from 'react-router-dom';
import { useShop } from '../lib/shop';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/sales', label: 'Sales' },
  { to: '/reports', label: 'Reports' },
  { to: '/users', label: 'Users' },
  { to: '/settings', label: 'Settings' }
];

export default function Sidebar(){
  const shop = useShop();
  return (
    <aside className="w-56 bg-white border-r flex flex-col">
      <div className="p-4 font-bold text-lg">{shop.name}</div>
      <nav className="flex-1 overflow-auto">
        {links.map(l => (
          <NavLink key={l.to} to={l.to} className={({isActive})=> `block px-4 py-2 text-sm hover:bg-gray-100 ${isActive?'bg-gray-200 font-medium':''}`}>{l.label}</NavLink>
        ))}
      </nav>
      <div className="p-4 text-xs text-gray-400">v0.1.0</div>
    </aside>
  );
}
