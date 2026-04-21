import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../context/SupabaseAuthContext';

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) return null;
  return session ? <Outlet /> : <Navigate to="/login" replace />;
}
