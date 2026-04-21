import { useState, useEffect } from 'react';
import { Edit2, Trash2, Plus, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Link, useNavigate } from 'react-router';

interface PortfolioItem {
  ticker: string;
  name: string;
  amount: number;
}

interface SavedPortfolio {
  id: string;
  name: string;
  budget: number;
  items: PortfolioItem[];
  totalAllocated: number;
  createdAt: string;
  updatedAt: string;
}

export function UserPortfolio() {
  const navigate = useNavigate();
  const [portfolios, setPortfolios] = useState<SavedPortfolio[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<SavedPortfolio | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  // Load portfolios from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('userPortfolios');
    if (saved) {
      try {
        const parsedPortfolios = JSON.parse(saved);
        setPortfolios(parsedPortfolios);
      } catch (error) {
        console.error('Failed to parse saved portfolios:', error);
      }
    }
  }, []);

  const handleDeletePortfolio = (id: string) => {
    const confirmed = window.confirm('Are you sure you want to delete this portfolio?');
    if (confirmed) {
      const updatedPortfolios = portfolios.filter(p => p.id !== id);
      setPortfolios(updatedPortfolios);
      localStorage.setItem('userPortfolios', JSON.stringify(updatedPortfolios));
      if (selectedPortfolio?.id === id) {
        setSelectedPortfolio(null);
      }
    }
  };

  const handleEditPortfolioName = (portfolio: SavedPortfolio) => {
    setSelectedPortfolio(portfolio);
    setEditedName(portfolio.name);
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    if (selectedPortfolio && editedName.trim()) {
      const updatedPortfolios = portfolios.map(p => 
        p.id === selectedPortfolio.id 
          ? { ...p, name: editedName, updatedAt: new Date().toISOString() }
          : p
      );
      setPortfolios(updatedPortfolios);
      localStorage.setItem('userPortfolios', JSON.stringify(updatedPortfolios));
      
      const updatedSelected = updatedPortfolios.find(p => p.id === selectedPortfolio.id);
      if (updatedSelected) {
        setSelectedPortfolio(updatedSelected);
      }
      setIsEditingName(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getPercentage = (amount: number, total: number) => {
    if (total > 0) {
      return ((amount / total) * 100).toFixed(1);
    }
    return '0.0';
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 mb-2">My Portfolios</h1>
          <p className="text-slate-400">Manage and analyze your saved portfolio allocations</p>
        </div>
        <Link to="/research/overview">
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
            <Plus className="w-4 h-4" />
            Create New Portfolio
          </Button>
        </Link>
      </div>

      {portfolios.length === 0 ? (
        <div className="flex items-center justify-center min-h-[400px] mt-16">
          <div className="text-center bg-slate-900/50 border border-slate-800 rounded-lg p-8 max-w-sm mx-auto">
            <h2 className="text-lg font-semibold text-slate-300 mb-2">No Portfolios Yet</h2>
            <p className="text-slate-400 text-sm mb-4">
              Create your first portfolio by building and saving assets in the Portfolio Builder.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Portfolios List */}
          <div className="lg:col-span-1">
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-slate-800 bg-slate-900">
                <h2 className="text-slate-100 font-semibold">Your Portfolios ({portfolios.length})</h2>
              </div>
              <div className="divide-y divide-slate-800 max-h-[600px] overflow-y-auto">
                {portfolios.map((portfolio) => (
                  <button
                    key={portfolio.id}
                    onClick={() => {
                      setSelectedPortfolio(portfolio);
                      setIsEditingName(false);
                    }}
                    className={`w-full text-left p-4 transition-colors ${
                      selectedPortfolio?.id === portfolio.id
                        ? 'bg-emerald-500/10 border-l-4 border-l-emerald-500'
                        : 'hover:bg-slate-800/50 border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-slate-100 font-medium truncate">{portfolio.name}</h3>
                        <p className="text-slate-400 text-xs mt-1">
                          {portfolio.items.length} asset{portfolio.items.length !== 1 ? 's' : ''}
                        </p>
                        <p className="text-emerald-400 text-sm font-semibold mt-2">
                          {formatCurrency(portfolio.budget)}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0 mt-1" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Portfolio Details */}
          {selectedPortfolio && (
            <div className="lg:col-span-2 space-y-6">
              {/* Portfolio Header */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      {isEditingName ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="flex-1 px-3 py-2 bg-slate-800 border border-emerald-600 rounded text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            autoFocus
                          />
                          <Button
                            onClick={handleSaveName}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            size="sm"
                          >
                            Save
                          </Button>
                          <Button
                            onClick={() => setIsEditingName(false)}
                            className="bg-slate-700 hover:bg-slate-600 text-slate-100"
                            size="sm"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <h2 className="text-2xl font-bold text-slate-100 mb-1">{selectedPortfolio.name}</h2>
                          <p className="text-slate-400 text-sm">
                            Created {formatDate(selectedPortfolio.createdAt)}
                          </p>
                        </div>
                      )}
                    </div>
                    {!isEditingName && (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleEditPortfolioName(selectedPortfolio)}
                          variant="ghost"
                          size="sm"
                          className="text-slate-400 hover:text-emerald-400 hover:bg-slate-800/50"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleDeletePortfolio(selectedPortfolio.id)}
                          variant="ghost"
                          size="sm"
                          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Portfolio Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-800/50 rounded p-3">
                      <p className="text-slate-400 text-xs mb-1">Total Budget</p>
                      <p className="text-emerald-400 text-lg font-bold">
                        {formatCurrency(selectedPortfolio.budget)}
                      </p>
                    </div>
                    <div className="bg-slate-800/50 rounded p-3">
                      <p className="text-slate-400 text-xs mb-1">Allocated</p>
                      <p className="text-slate-100 text-lg font-bold">
                        {formatCurrency(selectedPortfolio.totalAllocated)}
                      </p>
                    </div>
                    <div className="bg-slate-800/50 rounded p-3">
                      <p className="text-slate-400 text-xs mb-1">Remaining</p>
                      <p className={`text-lg font-bold ${
                        selectedPortfolio.budget - selectedPortfolio.totalAllocated >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}>
                        {formatCurrency(selectedPortfolio.budget - selectedPortfolio.totalAllocated)}
                      </p>
                    </div>
                  </div>

                  {/* Allocation Bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-400 text-sm">Capital Deployment</span>
                      <span className="text-slate-300 text-sm font-medium">
                        {getPercentage(selectedPortfolio.totalAllocated, selectedPortfolio.budget)}%
                      </span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          selectedPortfolio.totalAllocated <= selectedPortfolio.budget
                            ? 'bg-emerald-500'
                            : 'bg-red-500'
                        }`}
                        style={{
                          width: `${Math.min(
                            (selectedPortfolio.totalAllocated / selectedPortfolio.budget) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Holdings Table */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="p-4 border-b border-slate-800 bg-slate-900">
                    <h3 className="text-slate-100 font-semibold">
                      Holdings ({selectedPortfolio.items.length})
                    </h3>
                  </div>
                  {selectedPortfolio.items.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">
                      <p>No assets in this portfolio</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800">
                      {selectedPortfolio.items.map((item, index) => (
                        <div
                          key={`${item.ticker}-${index}`}
                          className="p-4 hover:bg-slate-800/30 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-slate-100 font-semibold">{item.ticker}</p>
                              <p className="text-slate-400 text-sm">{item.name}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-emerald-400 font-semibold">
                                {formatCurrency(item.amount)}
                              </p>
                              <p className="text-slate-400 text-sm">
                                {getPercentage(item.amount, selectedPortfolio.budget)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => navigate('/research/report', {
                    state: {
                      selectedPortfolioId: selectedPortfolio.id,
                    },
                  })}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                    Generate Report
                  </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
