import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { Trade } from './pages/Trade';
import { ResearchOverview } from './pages/ResearchOverview';
import { UserPortfolio } from './pages/UserPortfolio';
import { InvestmentReport } from './pages/InvestmentReport';
import { Chat } from './pages/Chat';
import { PerformanceHistory } from './pages/PerformanceHistory';
import { Transfers } from './pages/Transfers';
import { StockDetail } from './pages/StockDetail';
import { CryptoDetail } from './pages/CryptoDetail';
import { ResearchOptionsDetail } from './pages/ResearchOptionsDetail';
import { AccountSettings } from './pages/AccountSettings';

export const router = createBrowserRouter([
  // Public routes
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <Login /> },
  { path: '/signup', element: <Signup /> },

  // Protected app routes (pathless layout route — ProtectedRoute wraps all children)
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/dashboard', element: <Dashboard /> },
          { path: '/dashboard/performance-history', element: <PerformanceHistory /> },
          {
            path: '/dashboard/trade-history',
            element: <Navigate to="/trade?tab=orders" replace />,
          },
          { path: '/trade', element: <Trade /> },
          { path: '/stock/:ticker', element: <StockDetail /> },
          { path: '/crypto/:ticker', element: <CryptoDetail /> },
          { path: '/transfers', element: <Transfers /> },
          {
            path: '/research',
            element: <Navigate to="/research/overview" replace />,
          },
          { path: '/research/overview', element: <ResearchOverview /> },
          { path: '/research/stock/:ticker', element: <StockDetail /> },
          { path: '/research/crypto/:ticker', element: <CryptoDetail /> },
          { path: '/research/options/:ticker', element: <ResearchOptionsDetail /> },
          { path: '/research/portfolio', element: <UserPortfolio /> },
          { path: '/research/report', element: <InvestmentReport /> },
          { path: '/chat', element: <Chat /> },
          { path: '/settings', element: <AccountSettings /> },
          // Legacy redirect
          { path: '/portfolio', element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);
