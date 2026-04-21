import { Link, useLocation, useNavigate } from 'react-router';
import { User, Settings, LogOut, ArrowRightLeft, MessageSquare } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useAuth } from '../context/AuthContext';
import logo from '../logo.png';

const PRIMARY_NAV_ITEMS = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Trade', path: '/trade' },
  { name: 'Research', path: '/research/overview' },
  { name: 'Chat', path: '/chat' },
] as const;

const RESEARCH_SUB_ITEMS = [
  { name: 'Overview', path: '/research/overview' },
  { name: 'My Portfolios', path: '/research/portfolio' },
  { name: 'Investment Report', path: '/research/report' },
] as const;

export function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { logout } = useAuth();
  const isResearchActive = location.pathname.startsWith('/research');
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    setIsAccountDropdownOpen(false);
    logout();
    navigate('/login', { replace: true });
  };

  const handleShareFeedback = () => {
    setIsAccountDropdownOpen(false);
    window.open('https://forms.gle/UZQ1pK38auoPujyP6', '_blank', 'noopener,noreferrer');
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <nav className="relative z-50 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      {/* Primary Navigation */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center">
          <Link to="/dashboard" className="flex items-center gap-2 mr-8">
            <img src={logo} alt="Logo" className="h-10 w-auto" />
          </Link>
          <div className="flex gap-1">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const isActive = item.name === 'Research'
                ? isResearchActive
                : item.name === 'Dashboard'
                  ? location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/')
                  : location.pathname === item.path;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Account Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-slate-400" />
              )}
            </div>
          </button>

          {/* Dropdown Panel */}
          {isAccountDropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-lg shadow-xl shadow-black/20 overflow-hidden z-[9999]">
              <div className="py-1">
                <Link
                  to="/transfers"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:bg-slate-800/50 hover:text-emerald-400 transition-colors"
                  onClick={() => setIsAccountDropdownOpen(false)}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span className="text-sm">Transfers</span>
                </Link>

                <Link
                  to="/settings"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:bg-slate-800/50 hover:text-slate-100 transition-colors"
                  onClick={() => setIsAccountDropdownOpen(false)}
                >
                  <Settings className="w-4 h-4" />
                  <span className="text-sm">Settings</span>
                </Link>

                <button
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:bg-slate-800/50 hover:text-slate-100 transition-colors"
                  onClick={handleShareFeedback}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-sm">Support & Feedback</span>
                </button>
                
                <div className="h-px bg-slate-800 my-1"></div>
                
                <button
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:bg-slate-800/50 hover:text-red-400 transition-colors"
                  onClick={handleLogout}
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm">Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Research Sub-Navigation */}
      {isResearchActive && (
        <div className="border-t border-slate-800/50 bg-slate-900/30 px-6 py-3">
          <div className="flex gap-1">
            {RESEARCH_SUB_ITEMS.map((item) => {
              const isActive = location.pathname === item.path;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
