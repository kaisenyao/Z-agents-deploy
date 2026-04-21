import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';
import { MarketQuoteProvider } from './context/MarketQuoteContext';
import { TradeProvider } from './context/TradeContext';
import { ProfileProvider } from './context/ProfileContext';

export default function App() {
  return (
    <AuthProvider>
      <ProfileProvider>
        <MarketQuoteProvider>
          <TradeProvider>
            <RouterProvider router={router} />
          </TradeProvider>
        </MarketQuoteProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}
