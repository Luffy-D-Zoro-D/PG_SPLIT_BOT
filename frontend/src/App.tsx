import React, { useEffect, useState } from 'react';
import { Wallet, Users, Activity, LogOut, Search, CreditCard, ArrowRight } from 'lucide-react';

export default function App() {
  const [stats, setStats] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, expensesRes, balancesRes] = await Promise.all([
          fetch('http://localhost:3000/api/stats').then(r => r.json()),
          fetch('http://localhost:3000/api/expenses').then(r => r.json()),
          fetch('http://localhost:3000/api/balances').then(r => r.json())
        ]);
        setStats(statsRes);
        setExpenses(expensesRes);
        setBalances(balancesRes);
      } catch (e) {
        console.error('Failed to load dashboard data', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const refreshData = async () => {
    try {
      const [statsRes, expensesRes, balancesRes] = await Promise.all([
        fetch('http://localhost:3000/api/stats').then(r => r.json()),
        fetch('http://localhost:3000/api/expenses').then(r => r.json()),
        fetch('http://localhost:3000/api/balances').then(r => r.json())
      ]);
      setStats(statsRes);
      setExpenses(expensesRes);
      setBalances(balancesRes);
    } catch (e) {
      console.error('Failed to refresh data', e);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    
    try {
      await fetch(`http://localhost:3000/api/expenses/${id}`, {
        method: 'DELETE'
      });
      await refreshData();
    } catch (e) {
      console.error('Failed to delete expense', e);
    }
  };

  const handleSettle = async (balance: any) => {
    if (!confirm(`Mark ₹${balance.amount} from ${balance.debtorName} to ${balance.creditorName} as settled?`)) return;
    
    const [debtorId, creditorId] = balance.id.split('-');
    
    try {
      await fetch('http://localhost:3000/api/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtorId,
          creditorId,
          amount: balance.amount
        })
      });
      await refreshData();
    } catch (e) {
      console.error('Failed to settle balance', e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-200 font-sans selection:bg-blue-500/30">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#0F172A]/80 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent tracking-tight">
                PG SPLITTER
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative group">
                <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 group-hover:text-blue-400 transition-colors" />
                <input 
                  type="text" 
                  placeholder="Search expenses..." 
                  className="bg-slate-800/50 border border-slate-700 rounded-full py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all w-64"
                />
              </div>
              <button className="p-2 text-slate-400 hover:text-white transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard 
            title="Total Recorded" 
            value={`₹${stats?.totalAmountRecorded || '0'}`} 
            icon={<Activity className="w-6 h-6 text-emerald-400" />}
            gradient="from-emerald-500/20 to-emerald-500/0"
            border="border-emerald-500/20"
          />
          <MetricCard 
            title="Total Expenses" 
            value={stats?.totalExpenses || '0'} 
            icon={<CreditCard className="w-6 h-6 text-blue-400" />}
            gradient="from-blue-500/20 to-blue-500/0"
            border="border-blue-500/20"
          />
          <MetricCard 
            title="Active Groups" 
            value={stats?.totalGroups || '0'} 
            icon={<Users className="w-6 h-6 text-purple-400" />}
            gradient="from-purple-500/20 to-purple-500/0"
            border="border-purple-500/20"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Recent Expenses */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-semibold text-white flex items-center">
              Recent Activity
            </h2>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-1 overflow-hidden backdrop-blur-sm shadow-xl">
              {expenses.length === 0 ? (
                <div className="p-12 text-center text-slate-500 flex flex-col items-center">
                  <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <Activity className="w-8 h-8 text-slate-600" />
                  </div>
                  No expenses recorded yet. Tell the bot about your first transaction!
                </div>
              ) : (
                <div className="divide-y divide-slate-700/50">
                  {expenses.map((expense) => (
                    <div key={expense._id} className="p-4 hover:bg-slate-800/60 transition-colors flex flex-col group rounded-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          {expense.imageUrl ? (
                            <img src={`http://localhost:3000${expense.imageUrl}`} alt="Receipt" className="w-12 h-12 rounded-lg object-cover border border-slate-600 shadow-inner" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-lg font-bold text-slate-300 border border-slate-600 shadow-inner">
                              {String(expense.paidByName).charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-slate-200">
                              {expense.description || 'General Expense'}
                            </p>
                            <p className="text-sm text-slate-500">
                              Paid by <span className="text-slate-300 font-medium">{expense.paidByName}</span>
                              <span className="mx-2">•</span>
                              {new Date(expense.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg text-white">₹{expense.totalAmount}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mt-1 ${
                            expense.status === 'CONFIRMED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            expense.status === 'CANCELLED' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                            'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                          }`}>
                            {expense.status}
                          </span>
                        </div>
                      </div>
                      
                      {/* Breakdown Section */}
                      <div className="mt-4 pt-3 border-t border-slate-700/30 flex justify-between items-end">
                        <div className="text-sm">
                          {parseFloat(expense.sharedAmount) > 0 && (
                            <div className="mb-2">
                              <span className="text-slate-400">Shared (₹{expense.sharedAmount}): </span>
                              <span className="text-slate-300">
                                {expense.sharedParticipants?.map((p: any) => `${p.name} (₹${p.share})`).join(', ')}
                              </span>
                            </div>
                          )}
                          {expense.personalExpenses && expense.personalExpenses.length > 0 && (
                            <div>
                              <span className="text-slate-400">Personal: </span>
                              <span className="text-slate-300">
                                {expense.personalExpenses.map((p: any) => `${p.name} (₹${p.share})`).join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={() => handleDeleteExpense(expense._id)}
                          className="text-xs text-rose-400/70 hover:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg border border-rose-500/20 transition-all opacity-0 group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Ledger Balances */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Who owes whom</h2>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 backdrop-blur-sm shadow-xl">
              {balances.length === 0 ? (
                <div className="text-center text-slate-500 py-8">All settled up! 🚀</div>
              ) : (
                <div className="space-y-3">
                  {balances.map((balance) => (
                    <div key={balance.id} className="flex flex-col p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-all hover:shadow-lg group">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center space-x-3">
                          <div className="text-sm">
                            <p className="font-medium text-rose-400 text-right">{balance.debtorName}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-500" />
                          <div className="text-sm">
                            <p className="font-medium text-emerald-400">{balance.creditorName}</p>
                          </div>
                        </div>
                        <span className="font-bold text-white bg-slate-700/50 px-2 py-1 rounded-lg">₹{balance.amount}</span>
                      </div>
                      <button
                        onClick={() => handleSettle(balance)}
                        className="w-full mt-3 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg border border-emerald-500/20 transition-all opacity-0 group-hover:opacity-100"
                      >
                        Settle Balance
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}

function MetricCard({ title, value, icon, gradient, border }: any) {
  return (
    <div className={`relative overflow-hidden bg-slate-800/40 backdrop-blur-sm rounded-2xl border ${border} p-6 group hover:-translate-y-1 transition-all duration-300 shadow-lg`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-50 group-hover:opacity-100 transition-opacity`} />
      <div className="relative flex justify-between items-start">
        <div>
          <p className="text-slate-400 text-sm font-medium">{title}</p>
          <h3 className="text-3xl font-bold text-white mt-2 tracking-tight">{value}</h3>
        </div>
        <div className="p-3 bg-slate-900/50 rounded-xl shadow-inner border border-slate-700/50">
          {icon}
        </div>
      </div>
    </div>
  );
}
