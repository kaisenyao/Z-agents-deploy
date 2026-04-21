import { ArrowLeft, ArrowDown, ArrowUp, Send, ScrollText } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { useState, useEffect } from 'react';
import { CASH_VALUE } from '../data/portfolioHoldings';
import { useTradeContext } from '../context/TradeContext';
import { appendCashActivityRecord, loadCashActivityHistory, type CashActivityRecord } from '../store/tradingStore';

export function Transfers() {
  const { cash, setCashValue } = useTradeContext();
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'transfer' | 'cash-activity'>('deposit');
  const [amount, setAmount] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [currentCash, setCurrentCash] = useState(CASH_VALUE);
  const [cashActivityHistory, setCashActivityHistory] = useState<CashActivityRecord[]>(() => loadCashActivityHistory());
  const [message, setMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setCurrentCash(cash);
  }, [cash]);

  const saveCashValue = (newCash: number) => {
    localStorage.setItem('portfolioCash', newCash.toString());
    setCurrentCash(newCash);
    setCashValue(newCash);
  };

  const recordCashActivity = (
    type: CashActivityRecord['type'],
    activityAmount: number,
    resultingCash: number,
    note?: string,
  ) => {
    const nextHistory = appendCashActivityRecord({
      id: `cash-${type}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type,
      amount: activityAmount,
      status: 'completed',
      resultingCash,
      note,
    });
    setCashActivityHistory(nextHistory);
  };

  const handleDeposit = () => {
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      setMessage('Please enter a valid amount');
      return;
    }

    setIsProcessing(true);
    // Simulate processing
    setTimeout(() => {
      const newCash = currentCash + depositAmount;
      saveCashValue(newCash);
      recordCashActivity('deposit', depositAmount, newCash);
      setMessage(`Successfully deposited $${depositAmount.toFixed(2)}`);
      setAmount('');
      setIsProcessing(false);
      setTimeout(() => setMessage(''), 3000);
    }, 800);
  };

  const handleWithdraw = () => {
    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      setMessage('Please enter a valid amount');
      return;
    }

    if (withdrawAmount > currentCash) {
      setMessage(`Insufficient funds. Available: $${currentCash.toFixed(2)}`);
      return;
    }

    setIsProcessing(true);
    // Simulate processing
    setTimeout(() => {
      const newCash = currentCash - withdrawAmount;
      saveCashValue(newCash);
      recordCashActivity('withdraw', withdrawAmount, newCash);
      setMessage(`Successfully withdrew $${withdrawAmount.toFixed(2)}`);
      setAmount('');
      setIsProcessing(false);
      setTimeout(() => setMessage(''), 3000);
    }, 800);
  };

  const handleTransfer = () => {
    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      setMessage('Please enter a valid amount');
      return;
    }

    if (!transferTo.trim()) {
      setMessage('Please enter a transfer destination');
      return;
    }

    if (transferAmount > currentCash) {
      setMessage(`Insufficient funds. Available: $${currentCash.toFixed(2)}`);
      return;
    }

    setIsProcessing(true);
    // Simulate processing
    setTimeout(() => {
      const newCash = currentCash - transferAmount;
      saveCashValue(newCash);
      recordCashActivity('transfer', transferAmount, newCash, `To ${transferTo}`);
      setMessage(`Successfully transferred $${transferAmount.toFixed(2)} to ${transferTo}`);
      setAmount('');
      setTransferTo('');
      setIsProcessing(false);
      setTimeout(() => setMessage(''), 3000);
    }, 800);
  };

  const handleAction = () => {
    if (activeTab === 'deposit') {
      handleDeposit();
    } else if (activeTab === 'withdraw') {
      handleWithdraw();
    } else {
      handleTransfer();
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        to="/portfolio"
        className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back to Portfolio</span>
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-slate-100 mb-2">Account Transfers</h1>
        <p className="text-slate-400">Manage your cash balance</p>
      </div>

      {/* Current Cash Balance */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <p className="text-slate-400 text-sm mb-2">Available Cash</p>
        <p className="text-3xl font-semibold text-emerald-400">
          ${currentCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      {/* Transfer Operations */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <div className="flex gap-2 mb-6 border-b border-slate-800">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors ${
              activeTab === 'deposit'
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <ArrowDown className="w-4 h-4" />
            Deposit
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors ${
              activeTab === 'withdraw'
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <ArrowUp className="w-4 h-4" />
            Withdraw
          </button>
          <button
            onClick={() => setActiveTab('transfer')}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors ${
              activeTab === 'transfer'
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <Send className="w-4 h-4" />
            Transfer
          </button>
          <button
            onClick={() => setActiveTab('cash-activity')}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors ${
              activeTab === 'cash-activity'
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <ScrollText className="w-4 h-4" />
            Cash Activity
          </button>
        </div>

        {activeTab !== 'cash-activity' ? (
          <>
            <div className="space-y-4">
              <div>
                {activeTab === 'deposit' && (
                  <p className="text-slate-400 text-sm mb-4">Add funds to your account for investment opportunities.</p>
                )}
                {activeTab === 'withdraw' && (
                  <p className="text-slate-400 text-sm mb-4">Withdraw available cash from your account.</p>
                )}
                {activeTab === 'transfer' && (
                  <p className="text-slate-400 text-sm mb-4">Transfer funds to another account or destination.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Amount (USD)</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isProcessing}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  min="0"
                  step="0.01"
                />
              </div>

              {activeTab === 'transfer' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Transfer To</label>
                  <input
                    type="text"
                    placeholder="Account name or ID"
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    disabled={isProcessing}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              )}

              {message && (
                <div className={`p-3 rounded-lg text-sm ${
                  message.includes('Error') || message.includes('Insufficient') || message.includes('Please')
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                }`}>
                  {message}
                </div>
              )}

              <Button
                onClick={handleAction}
                disabled={!amount || isProcessing || (activeTab === 'transfer' && !transferTo)}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Processing...
                  </span>
                ) : activeTab === 'deposit' ? (
                  'Deposit Funds'
                ) : activeTab === 'withdraw' ? (
                  'Withdraw Funds'
                ) : (
                  'Transfer Funds'
                )}
              </Button>

              {activeTab === 'deposit' && (
                <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-3">
                  {[
                    { label: 'Deposit $1,000', amount: 1000, type: 'deposit' },
                    { label: 'Deposit $5,000', amount: 5000, type: 'deposit' },
                    { label: 'Deposit $10,000', amount: 10000, type: 'deposit' },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={() => {
                        setAmount(action.amount.toString());
                        setActiveTab(action.type as 'deposit');
                      }}
                      className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg hover:border-emerald-500/50 hover:bg-slate-900/80 transition-all text-slate-300 hover:text-slate-100"
                    >
                      <p className="text-sm font-medium">{action.label}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            {cashActivityHistory.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-6 text-sm text-slate-500">
                No cash activity yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase text-slate-400">Time</th>
                      <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase text-slate-400">Type</th>
                      <th className="pb-3 pr-4 text-right text-xs font-semibold uppercase text-slate-400">Amount</th>
                      <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase text-slate-400">Status</th>
                      <th className="pb-3 pr-4 text-right text-xs font-semibold uppercase text-slate-400">Cash After</th>
                      <th className="pb-3 text-left text-xs font-semibold uppercase text-slate-400">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashActivityHistory.map((record) => {
                      const signedPrefix = record.type === 'deposit' ? '+' : '-';
                      const amountColor = record.type === 'deposit' ? 'text-emerald-400' : 'text-red-400';

                      return (
                        <tr key={record.id} className="border-b border-slate-800/50">
                          <td className="py-3 pr-4 text-sm text-slate-300">
                            {new Date(record.timestamp).toLocaleString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 pr-4 text-sm capitalize text-slate-300">{record.type}</td>
                          <td className={`py-3 pr-4 text-right text-sm font-medium ${amountColor}`}>
                            {signedPrefix}${record.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 pr-4 text-sm">
                            <span className="inline-block rounded px-2 py-1 text-xs bg-emerald-900/30 text-emerald-400 border border-emerald-800/50">
                              Completed
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-right text-sm text-slate-100">
                            ${record.resultingCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 text-sm text-slate-400">{record.note || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
