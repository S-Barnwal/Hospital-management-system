import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const TenantAuth = createContext(null);

/** Hospital-user session. `me` comes from GET /tenant/me — the server decides tenant and permissions. */
export function TenantAuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/tenant/me');
      setMe(res.data);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setMe(null);
  }, []);
  const value = useMemo(() => ({
    me, loading, refresh, logout,
    can: (...perms) => perms.every((p) => me?.permissions?.includes(p)),
  }), [me, loading, refresh, logout]);
  return <TenantAuth.Provider value={value}>{children}</TenantAuth.Provider>;
}
export const useTenantAuth = () => useContext(TenantAuth);

const AdminAuth = createContext(null);
export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setAdmin((await api.get('/auth/admin/me')).data); } catch { setAdmin(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = useCallback(async () => { await api.post('/auth/admin/logout').catch(() => {}); setAdmin(null); }, []);
  const value = useMemo(() => ({ admin, loading, refresh, logout }), [admin, loading, refresh, logout]);
  return <AdminAuth.Provider value={value}>{children}</AdminAuth.Provider>;
}
export const useAdminAuth = () => useContext(AdminAuth);
