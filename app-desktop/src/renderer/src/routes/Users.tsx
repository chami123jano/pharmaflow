import { useEffect, useState } from 'react';
import Select from '../components/Select';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

interface User { id: string; email: string; role: string; name?: string }

export default function Users({ user: currentUser, darkMode }: { user?: any; tokens?: any; darkMode?: boolean; onUserChanged?: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [users, setUsers]   = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState<User | null>(null);
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', role: 'clerk' });
  const [editForm, setEditForm] = useState({ name: '', username: '', email: '', role: 'clerk', password: '' });

  async function load() {
    const r: any = await window.api?.auth?.list?.();
    if (r?.ok) setUsers(r.data || []);
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('A username and password are required'); return; }
    if (form.password.length < 4) { toast.error('Password must be at least 4 characters'); return; }
    setLoading(true);
    const res: any = await window.api?.auth?.register?.(form.username, form.password, form.role as any, form.name, form.email);
    setLoading(false);
    if (res?.ok) {
      toast.success('User created!');
      setForm({ name: '', email: '', password: '', role: 'clerk' });
      setShowAdd(false);
      load();
    } else {
      toast.error(res?.error === 'EMAIL_EXISTS' ? 'Email already exists' : (res?.error || 'Failed'));
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!showEdit) return;
    setLoading(true);
    const patch: any = { name: editForm.name, role: editForm.role };
    if (editForm.username) patch.username = editForm.username;
    if (editForm.email) patch.email = editForm.email;
    if (editForm.password) patch.password = editForm.password;
    const res: any = await window.api?.auth?.update?.(showEdit.id, patch);
    setLoading(false);
    if (res?.ok) { toast.success('User updated!'); setShowEdit(null); load(); }
    else toast.error(res?.error || 'Update failed');
  }

  async function handleDelete(u: User) {
    // Backend handles protection of system admin
    if (!(await ask({ title: `Delete ${u.username || u.email}?`, message: 'They will no longer be able to sign in. This cannot be undone.', tone: 'danger' }))) return;
    const res: any = await window.api?.auth?.delete?.(u.id);
    if (res?.ok) { toast.success('User deleted'); load(); }
    else toast.error(res?.error === 'LAST_ADMIN' ? 'Cannot delete the only admin' : (res?.error || 'Delete failed'));
  }

  function openEdit(u: User) {
    setEditForm({ name: u.name || '', username: u.username || '', email: u.email || '', role: u.role || 'clerk', password: '' });
    setShowEdit(u);
  }

  const dm = darkMode;
  const card = `rounded-2xl border shadow-sm ${dm ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
  const inp  = `w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/25 ${dm ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400' : 'bg-white border-slate-300 text-slate-900'}`;
  const lbl  = `block text-xs font-semibold uppercase tracking-wide mb-1 ${dm ? 'text-slate-400' : 'text-slate-500'}`;
  const tp   = dm ? 'text-slate-100' : 'text-slate-900';
  const ts   = dm ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${tp}`}>Users</h1>
          <p className={`text-sm ${ts}`}>{users.length} account{users.length !== 1 ? 's' : ''}</p>
        </div>
        {currentUser?.role === 'admin' && (
          <button onClick={() => { setForm({ name:'', email:'', password:'', role:'clerk' }); setShowAdd(true); }}
            className="px-4 py-2 bg-teal-700 text-white rounded-xl text-sm font-semibold hover:bg-teal-800">
            + Add User
          </button>
        )}
      </div>

      {/* User list */}
      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={`border-b ${dm ? 'border-slate-700 bg-slate-750' : 'border-slate-100 bg-slate-50'}`}>
            <tr>
              <th className={`text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide ${ts}`}>Name</th>
              <th className={`text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide ${ts}`}>Username</th>
              <th className={`text-center px-5 py-3 text-xs font-semibold uppercase tracking-wide ${ts}`}>Role</th>
              {currentUser?.role === 'admin' && (
                <th className={`text-right px-5 py-3 text-xs font-semibold uppercase tracking-wide ${ts}`}>Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={4} className={`text-center py-10 ${ts}`}>No users found</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className={`border-b transition-colors ${dm ? 'border-slate-700 hover:bg-slate-700' : 'border-slate-50 hover:bg-slate-50'}`}>
                <td className={`px-5 py-3.5 font-medium ${tp}`}>{u.name || '-'}</td>
                <td className={`px-5 py-3.5 ${ts}`}>
                  <span className={`font-medium ${tp}`}>{u.username || '-'}</span>
                  {u.email && !u.email.endsWith('@local') && <span className="block text-xs opacity-70">{u.email}</span>}
                </td>
                <td className="px-5 py-3.5 text-center">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${u.role === 'admin' ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>
                    {u.role}
                  </span>
                </td>
                {currentUser?.role === 'admin' && (
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(u)}
                        className="px-3 py-1 text-xs bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 font-medium">
                        Edit
                      </button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => handleDelete(u)}
                          className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium">
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-md ${dm ? 'bg-slate-800' : 'bg-white'} p-6`}>
            <h3 className={`text-lg font-bold mb-5 ${tp}`}>Add New User</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div><label className={lbl}>Display Name</label>
                <input className={inp} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. John Silva" /></div>
              <div><label className={lbl}>Email Address *</label>
                <input required className={inp} value={form.username} autoCapitalize="none" spellCheck={false}
                  onChange={e=>setForm(f=>({...f,username:e.target.value.replace(/\s/g,'').toLowerCase()}))} placeholder="nimali" /></div>
              <div><label className={lbl}>Email <span className="normal-case font-normal opacity-60">optional</span></label>
                <input type="email" className={inp} value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="Only if they have one" /></div>
              <div><label className={lbl}>Password * (min 4 chars)</label>
                <input required type="password" className={inp} value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="Set a password" /></div>
              <div><label className={lbl}>Role</label>
                <Select aria-label="Role" value={form.role} onChange={(v) => setForm(f => ({ ...f, role: v }))} options={[
                  { value: 'clerk', label: 'Clerk', hint: 'Sales and stock' },
                  { value: 'admin', label: 'Admin', hint: 'Everything' },
                ]} /></div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setShowAdd(false)} className={`flex-1 py-2.5 rounded-xl border ${dm?'border-slate-600 text-slate-300':'border-slate-300 text-slate-700'}`}>Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white font-bold hover:bg-teal-800 disabled:opacity-50">
                  {loading ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-md ${dm ? 'bg-slate-800' : 'bg-white'} p-6`}>
            <h3 className={`text-lg font-bold mb-1 ${tp}`}>Edit User</h3>
            <p className={`text-sm mb-5 ${ts}`}>{showEdit.email}</p>
            <form onSubmit={handleEdit} className="space-y-4">
              <div><label className={lbl}>Display Name</label>
                <input className={inp} value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} placeholder="Full name" /></div>
              <div><label className={lbl}>Role</label>
                <Select aria-label="Role" value={editForm.role} onChange={(v) => setEditForm(f => ({ ...f, role: v }))} options={[
                  { value: 'clerk', label: 'Clerk', hint: 'Sales and stock' },
                  { value: 'admin', label: 'Admin', hint: 'Everything' },
                ]} /></div>
              <div><label className={lbl}>New Password (leave blank to keep current)</label>
                <input type="password" className={inp} value={editForm.password} onChange={e=>setEditForm(f=>({...f,password:e.target.value}))} placeholder="Leave blank to keep" /></div>
              <div><label className={lbl}>Username</label>
                <input className={inp} value={editForm.username} autoCapitalize="none" spellCheck={false}
                  onChange={e=>setEditForm(f=>({...f,username:e.target.value.replace(/\s/g,'').toLowerCase()}))} placeholder="nimali" /></div>
              <div><label className={lbl}>Email</label>
                <input type="email" className={inp} value={editForm.email} onChange={e=>setEditForm(f=>({...f,email:e.target.value}))} placeholder="name@example.com" /></div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setShowEdit(null)} className={`flex-1 py-2.5 rounded-xl border ${dm?'border-slate-600 text-slate-300':'border-slate-300 text-slate-700'}`}>Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white font-bold hover:bg-teal-800 disabled:opacity-50">
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}