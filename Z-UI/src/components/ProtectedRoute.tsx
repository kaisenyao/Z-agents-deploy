import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { email } = useAuth();
  return email ? <Outlet /> : <Navigate to="/login" replace />;
}
