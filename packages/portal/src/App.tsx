import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';

// Pages (to be built out)
import LoginPage from './pages/LoginPage';
import TeamDashboard from './pages/TeamDashboard';
import SupplierDashboard from './pages/SupplierDashboard';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserRole(session.user.id);
      else setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserRole(session.user.id);
      else {
        setUserRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserRole(userId: string) {
    const { data } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    setUserRole(data?.role || null);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={
        session ? <Navigate to={userRole === 'supplier' ? '/supplier' : '/team'} /> : <LoginPage />
      } />
      <Route path="/team/*" element={
        session && (userRole === 'team' || userRole === 'admin')
          ? <TeamDashboard />
          : <Navigate to="/login" />
      } />
      <Route path="/supplier/*" element={
        session && userRole === 'supplier'
          ? <SupplierDashboard />
          : <Navigate to="/login" />
      } />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
}

export default App;
