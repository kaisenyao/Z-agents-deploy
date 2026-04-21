import { RouterProvider } from 'react-router';
import { router } from './routes';
import { SupabaseAuthProvider } from './context/SupabaseAuthContext';
import { MarketQuoteProvider } from './context/MarketQuoteContext';
import { TradeProvider } from './context/TradeContext';
import { ProfileProvider } from './context/ProfileContext';

export default function App() {
  return (
    <SupabaseAuthProvider>
      <ProfileProvider>
        <MarketQuoteProvider>
          <TradeProvider>
            <RouterProvider router={router} />
          </TradeProvider>
        </MarketQuoteProvider>
      </ProfileProvider>
    </SupabaseAuthProvider>
  );
}
