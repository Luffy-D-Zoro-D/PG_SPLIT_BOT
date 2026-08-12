import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, Users, Activity, Search, Sparkles, ArrowRight, Bot, X, Receipt, CheckCircle2, Handshake, MessageCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import toast, { Toaster } from 'react-hot-toast';
import QRCode from 'qrcode';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [stats, setStats] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExpense, setSelectedExpense] = useState<any>(null);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [groupId, setGroupId] = useState<string>(localStorage.getItem('pg_groupId') || '');
  const [timeRange, setTimeRange] = useState<'all' | 'month' | 'week'>('all');
  
  // Custom Modal State
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null);

  // Admin state & edits
  const isAdmin = window.location.pathname === '/sabo/ace';
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editDateValue, setEditDateValue] = useState<string>('');

  // WhatsApp QR & Settings state
  const [waQR, setWaQR] = useState<string | null>(null);
  const [waReady, setWaReady] = useState(false);
  const [waNotificationsEnabled, setWaNotificationsEnabled] = useState(false);
  const [waQRImage, setWaQRImage] = useState<string | null>(null);
  const [showWaPanel, setShowWaPanel] = useState(false);

  const fetchData = async () => {
    if (!groupId) {
      setLoading(false);
      return;
    }
    try {
      const [statsRes, expensesRes, balancesRes] = await Promise.all([
        fetch(`/api/stats?groupId=${groupId}&range=${timeRange}`).then(r => r.json()),
        fetch(`/api/expenses?groupId=${groupId}&range=${timeRange}`).then(r => r.json()),
        fetch(`/api/balances?groupId=${groupId}&range=${timeRange}`).then(r => r.json())
      ]);
      
      if (statsRes.error) throw new Error(statsRes.error);
      
      setStats(statsRes);
      setExpenses(expensesRes);
      setBalances(balancesRes);
    } catch (e) {
      console.error('Failed to load dashboard data', e);
      toast.error('Failed to sync with server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (groupId) {
      localStorage.setItem('pg_groupId', groupId);
      setLoading(true);
      fetchData();
      const interval = setInterval(fetchData, 15000); // Poll every 15s for live feel
      return () => clearInterval(interval);
    } else {
      setLoading(false);
    }
  }, [groupId, timeRange]);

  // Poll WhatsApp status & QR code
  useEffect(() => {
    const pollWA = async () => {
      try {
        const res = await fetch('/api/whatsapp-status');
        const data = await res.json();
        if (data.notificationsEnabled !== undefined) {
          setWaNotificationsEnabled(data.notificationsEnabled);
        }
        if (data.isReady) {
          setWaReady(true);
          setWaQR(null);
          setWaQRImage(null);
          return;
        }
        const qrRes = await fetch('/api/whatsapp-qr');
        const qrData = await qrRes.json();
        if (qrData.qr && qrData.qr !== waQR) {
          setWaQR(qrData.qr);
          const dataUrl = await QRCode.toDataURL(qrData.qr, { width: 256, margin: 1 });
          setWaQRImage(dataUrl);
        }
      } catch (e) {
        // Backend might not be ready yet
      }
    };

    pollWA();
    const interval = setInterval(pollWA, 4000);
    return () => clearInterval(interval);
  }, [waReady, waQR]);

  const toggleWaNotifications = async (enabled: boolean) => {
    setWaNotificationsEnabled(enabled);
    try {
      await fetch('/api/whatsapp-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsEnabled: enabled })
      });
      toast.success(enabled ? 'WhatsApp notifications ON' : 'WhatsApp notifications OFF');
    } catch (e) {
      toast.error('Failed to update WhatsApp notification setting');
    }
  };

  useEffect(() => {
    if (selectedExpense && selectedExpense.createdAt) {
      const d = new Date(selectedExpense.createdAt);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      setEditDateValue(`${year}-${month}-${day}T${hours}:${minutes}`);
      setEditImageFile(null);
    }
  }, [selectedExpense]);

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 1000;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSaveAdminEdits = async () => {
    if (!selectedExpense) return;
    try {
      let newImageUrl = selectedExpense.imageUrl;

      if (editImageFile) {
        newImageUrl = await compressImage(editImageFile);
      }

      const payload: any = {
        imageUrl: newImageUrl,
        createdAt: editDateValue ? new Date(editDateValue).toISOString() : selectedExpense.createdAt
      };

      const res = await fetch(`/api/expenses/${selectedExpense._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to update entry');
      
      toast.success('Entry updated successfully!');
      setSelectedExpense(null);
      setEditImageFile(null);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast.error('Failed to update entry');
    }
  };

  const handleDeleteExpense = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Entry',
      message: 'Are you sure you want to permanently delete this entry from the ledger? This action cannot be undone.',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch(`/api/expenses/${id}`, {
            method: 'DELETE'
          });
          if (!res.ok) throw new Error('Failed to delete');
          toast.success('Entry deleted successfully');
          await fetchData();
        } catch (e) {
          console.error(e);
          toast.error('Failed to delete entry');
        }
      }
    });
  };

  const handleSettle = (balance: any) => {
    setConfirmModal({
      isOpen: true,
      title: 'Request Settlement',
      message: `Send a settlement request for ₹${balance.amount} from ${balance.debtorName} to ${balance.creditorName}?`,
      onConfirm: async () => {
        setConfirmModal(null);
        const [debtorId, creditorId] = balance.id.split('-');
        try {
          const res = await fetch('/api/settle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              debtorId: debtorId,
              creditorId: creditorId,
              amount: balance.amount,
              groupId: groupId
            })
          });
          if (!res.ok) throw new Error('Failed to send request');
          toast.success('Settlement request sent to Telegram!');
          await fetchData();
        } catch (e) {
          console.error(e);
          toast.error('Failed to send settlement request');
        }
      }
    });
  };

  const filteredExpenses = useMemo(() => {
    if (!searchQuery.trim()) return expenses;
    const query = searchQuery.toLowerCase();
    return expenses.filter(e => {
      const desc = e.description?.toLowerCase() || '';
      const payer = String(e.paidByName || '').toLowerCase();
      const payee = String(e.paidToName || '').toLowerCase();
      return desc.includes(query) || payer.includes(query) || payee.includes(query);
    });
  }, [expenses, searchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center font-outfit">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          className="relative"
        >
          <div className="absolute inset-0 bg-purple-500 blur-3xl opacity-20 rounded-full" />
          <Bot className="w-12 h-12 text-purple-400 relative z-10" />
        </motion.div>
      </div>
    );
  }

  if (!groupId) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center font-sans p-4 relative overflow-hidden">
        <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="max-w-md w-full bg-[#18181b]/80 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-2xl flex flex-col items-center relative z-10">
          <div className="relative w-16 h-16 mb-6">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 blur-lg opacity-50" />
            <div className="relative w-full h-full rounded-2xl bg-black border border-white/10 flex items-center justify-center shadow-2xl">
              <Bot className="w-8 h-8 text-purple-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold font-heading mb-2">Welcome to PG SPLITTER</h1>
          <p className="text-neutral-400 text-center mb-6">Enter your Telegram Group ID to view your synchronized ledger.</p>
          <input 
            type="text" 
            placeholder="e.g. -10023456789" 
            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 mb-4 text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setGroupId(e.currentTarget.value.trim());
              }
            }}
          />
          <button 
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)]"
            onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              setGroupId(input.value.trim());
            }}
          >
            Access Ledger
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center font-sans p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold">Cannot connect to backend server</h1>
          <p className="text-neutral-400 max-w-sm">Make sure your backend is running on port 3000. It seems to have crashed or is unreachable.</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors mt-4"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-200 font-sans selection:bg-purple-500/30 relative overflow-hidden">
      <Toaster 
        position="top-center"
        toastOptions={{
          style: {
            background: '#18181b',
            color: '#f8fafc',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(10px)',
          }
        }}
      />
      
      {/* Background Glows */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Navbar */}
      <nav className="sticky top-0 z-40 backdrop-blur-2xl bg-[#09090b]/60 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 blur-lg opacity-50" />
                <div className="relative w-12 h-12 rounded-2xl bg-black border border-white/10 flex items-center justify-center shadow-2xl">
                  <Bot className="w-6 h-6 text-purple-400" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold font-heading bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent tracking-tight">
                  PG SPLITTER
                </h1>
                <p className="text-xs text-purple-400/80 font-medium tracking-widest uppercase flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI Powered
                </p>
              </div>
            </div>
            
            <div className="hidden md:flex items-center space-x-4">
              {/* WhatsApp Notification Toggle */}
              <div className="flex items-center space-x-2 bg-white/5 border border-white/10 px-3.5 py-2 rounded-full">
                <MessageCircle className={cn("w-4 h-4", waNotificationsEnabled ? "text-emerald-400" : "text-slate-500")} />
                <span className="text-xs text-slate-300 font-medium">WhatsApp Alerts</span>
                <button
                  onClick={() => toggleWaNotifications(!waNotificationsEnabled)}
                  className={cn(
                    "w-8 h-4 rounded-full transition-colors relative p-0.5 cursor-pointer",
                    waNotificationsEnabled ? "bg-emerald-500" : "bg-slate-700"
                  )}
                  title={waNotificationsEnabled ? "Disable WhatsApp Notifications" : "Enable WhatsApp Notifications"}
                >
                  <div className={cn(
                    "w-3 h-3 rounded-full bg-white transition-transform shadow-md",
                    waNotificationsEnabled ? "translate-x-4" : "translate-x-0"
                  )} />
                </button>
              </div>

              <div className="relative group">
                <Search className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-purple-400 transition-colors" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ledger..." 
                  className="bg-white/5 border border-white/10 rounded-full py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:bg-white/10 transition-all w-72 placeholder:text-slate-500"
                />
              </div>
              <button
                onClick={() => {
                  localStorage.removeItem('pg_groupId');
                  setGroupId('');
                }}
                className="text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-2 rounded-lg border border-red-500/20 transition-colors"
              >
                Switch Group
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* WhatsApp QR Floating Widget */}
      {!waReady && (
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={() => setShowWaPanel(!showWaPanel)}
            className="w-14 h-14 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 shadow-[0_0_25px_rgba(16,185,129,0.4)] hover:shadow-[0_0_35px_rgba(16,185,129,0.6)] flex items-center justify-center transition-all hover:scale-105"
          >
            <MessageCircle className="w-6 h-6 text-white" />
          </button>
          <AnimatePresence>
            {showWaPanel && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.9 }}
                className="absolute bottom-16 right-0 w-80 bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-bold text-sm">WhatsApp Setup</h3>
                  <button onClick={() => setShowWaPanel(false)} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {waQRImage ? (
                  <div className="flex flex-col items-center space-y-3">
                    <div className="bg-white p-3 rounded-xl">
                      <img src={waQRImage} alt="WhatsApp QR" className="w-52 h-52" />
                    </div>
                    <p className="text-xs text-slate-400 text-center">Scan this QR code with your WhatsApp to connect the bot</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center space-y-3 py-4">
                    <div className="w-10 h-10 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                    <p className="text-xs text-slate-400">Waiting for QR code...</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 relative z-10">
        
        {/* Time Range Filter Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white/[0.02] border border-white/5 p-3 rounded-2xl gap-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 font-semibold px-2 uppercase tracking-wider">Filter Timeframe:</span>
            {(['all', 'month', 'week'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  "px-4 py-1.5 rounded-xl text-xs font-medium transition-all capitalize",
                  timeRange === range
                    ? "bg-purple-600/30 text-purple-300 border border-purple-500/40 shadow-lg shadow-purple-500/10"
                    : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                )}
              >
                {range === 'all' ? 'All Time' : range === 'month' ? 'This Month' : 'This Week'}
              </button>
            ))}
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard 
            title="Total Recorded" 
            value={`₹${stats?.totalAmountRecorded || '0'}`} 
            icon={<Wallet className="w-5 h-5 text-purple-400" />}
            delay={0.1}
          />
          <MetricCard 
            title="Total Expenses" 
            value={stats?.totalExpenses || '0'} 
            icon={<Receipt className="w-5 h-5 text-blue-400" />}
            delay={0.2}
          />
          <MetricCard 
            title="Active Groups" 
            value={stats?.totalGroups || '0'} 
            icon={<Users className="w-5 h-5 text-emerald-400" />}
            delay={0.3}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Ledger Feed */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-heading font-semibold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-400" /> Ledger Activity
              </h2>
            </div>
            
            <div className="space-y-4">
              {filteredExpenses.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white/[0.02] border border-white/5 rounded-3xl">
                  {searchQuery ? 'No matching entries found.' : 'Tell the bot about your first transaction!'}
                </div>
              ) : (
                <AnimatePresence>
                  {filteredExpenses.map((entry, i) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      key={entry._id} 
                      onClick={() => entry.type === 'EXPENSE' ? setSelectedExpense(entry) : null}
                      className={cn(
                        "group p-5 bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 rounded-2xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4",
                        entry.type === 'EXPENSE' && "cursor-pointer"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        {entry.type === 'SETTLEMENT' ? (
                          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-900/20 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-lg shrink-0">
                            <Handshake className="w-6 h-6" />
                          </div>
                        ) : entry.imageUrl ? (
                          <div className="w-14 h-14 rounded-xl overflow-hidden border border-white/10 shadow-lg shrink-0 bg-slate-900 flex items-center justify-center">
                            {/\.(mp3|wav|ogg|oga|m4a|aac)$/i.test(entry.imageUrl) ? (
                               <Activity className="w-6 h-6 text-purple-400" />
                            ) : (
                               <img src={entry.imageUrl} alt="Receipt" className="w-full h-full object-cover" />
                            )}
                          </div>
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center text-xl font-heading font-bold text-slate-400 shadow-lg shrink-0 group-hover:text-white transition-colors">
                            {String(entry.paidByName).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-slate-200 text-lg">
                              {entry.type === 'SETTLEMENT' 
                                ? `${entry.paidByName} settled with ${entry.paidToName}` 
                                : (entry.description || 'General Expense')}
                            </h3>
                          </div>
                          <p className="text-sm text-slate-500">
                            {entry.type === 'SETTLEMENT' ? 'Settlement' : `Paid by `} 
                            {entry.type !== 'SETTLEMENT' && <span className="text-slate-300">{entry.paidByName}</span>}
                            <span className="mx-2 opacity-50">•</span>
                            {new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                        <div className="text-right">
                          <p className={cn("font-heading font-bold text-xl", entry.type === 'SETTLEMENT' ? 'text-emerald-400' : 'text-white')}>
                            ₹{entry.totalAmount}
                          </p>
                          <p className={cn("text-xs font-medium uppercase tracking-wider mt-1", 
                            entry.status === 'CONFIRMED' ? 'text-emerald-400' :
                            entry.status === 'CANCELLED' ? 'text-rose-400' :
                            'text-amber-400 animate-pulse'
                          )}>
                            {entry.type === 'SETTLEMENT' 
                              ? (entry.status === 'CONFIRMED' ? 'SETTLED' : 'APPROVAL PENDING')
                              : entry.status}
                          </p>
                        </div>
                        {window.location.pathname === '/sabo/ace' && entry.type === 'EXPENSE' && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDeleteExpense(entry._id); }}
                            className="opacity-0 group-hover:opacity-100 p-2 text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>

          {/* Right Column: Ledger Balances */}
          <div className="space-y-6">
            <h2 className="text-xl font-heading font-semibold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-400" /> Who Owes Whom
            </h2>
            <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-2">
              {balances.length === 0 ? (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500/50 mb-3" />
                  All settled up!
                </div>
              ) : (
                <div className="space-y-2">
                  {balances.map((balance, i) => (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.1 }}
                      key={balance.id} 
                      className="p-4 bg-black/40 rounded-2xl border border-white/5 hover:bg-white/[0.04] transition-colors group relative overflow-hidden"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-xs text-slate-500 mb-0.5 uppercase tracking-wider font-semibold">Debtor</p>
                            <p className="font-medium text-rose-400">{balance.debtorName}</p>
                          </div>
                          <div className="px-2 py-1 bg-white/5 rounded-full">
                            <ArrowRight className="w-4 h-4 text-slate-500" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-0.5 uppercase tracking-wider font-semibold">Creditor</p>
                            <p className="font-medium text-emerald-400">{balance.creditorName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-heading font-bold text-lg text-white">₹{balance.amount}</span>
                        </div>
                      </div>
                      
                      <div className="mb-4 pt-4 border-t border-white/5 space-y-1">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>{balance.creditorName} spent for {balance.debtorName}:</span>
                          <span className="font-medium text-white">₹{balance.grossDebtorToCreditor}</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>{balance.debtorName} spent for {balance.creditorName}:</span>
                          <span className="font-medium text-white">₹{balance.grossCreditorToDebtor}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleSettle(balance)}
                        className="w-full py-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 hover:border-purple-500/40 font-medium transition-all flex items-center justify-center gap-2"
                      >
                        Ask to Settle <Sparkles className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </main>

      {/* Custom Confirm Modal */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 10 }}
              className="bg-[#09090b] border border-white/10 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative"
            >
              <h3 className="text-xl font-heading font-bold text-white mb-2">{confirmModal.title}</h3>
              <p className="text-slate-400 text-sm mb-6">{confirmModal.message}</p>
              
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmModal.onConfirm}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors shadow-lg shadow-purple-500/20"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expense Modal */}
      <AnimatePresence>
        {selectedExpense && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md" 
            onClick={() => setSelectedExpense(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#09090b] border border-white/10 rounded-3xl max-w-4xl w-full max-h-[90vh] shadow-2xl flex flex-col md:flex-row overflow-hidden relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => setSelectedExpense(null)}
                className="absolute top-4 right-4 p-2 bg-white/5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors z-10"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Left side: Media */}
              {selectedExpense.imageUrl && (
                <div className="md:w-1/2 bg-black/50 p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-white/5 relative group">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-6 z-10 pointer-events-none">
                    <a href={selectedExpense.imageUrl} target="_blank" rel="noreferrer" className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-full text-sm font-medium hover:bg-white/20 transition-colors text-white pointer-events-auto">View Original</a>
                  </div>
                  {/\.(mp3|wav|ogg|oga|m4a|aac)$/i.test(selectedExpense.imageUrl) ? (
                    <div className="w-full flex flex-col items-center justify-center space-y-6">
                      <div className="w-24 h-24 rounded-full bg-purple-500/10 flex items-center justify-center">
                        <Activity className="w-12 h-12 text-purple-400" />
                      </div>
                      <audio 
                        controls 
                        src={selectedExpense.imageUrl} 
                        className="w-full max-w-sm"
                      />
                    </div>
                  ) : (
                    <img 
                      src={selectedExpense.imageUrl} 
                      alt="Receipt" 
                      className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-2xl relative z-0"
                    />
                  )}
                </div>
              )}
              
              {/* Right side: Details */}
              <div className={cn("p-8 md:p-10 flex flex-col bg-gradient-to-br from-[#09090b] to-slate-900/50", selectedExpense.imageUrl ? 'md:w-1/2' : 'w-full')}>
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={cn("px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border", 
                      selectedExpense.status === 'CONFIRMED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      selectedExpense.status === 'CANCELLED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                      'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    )}>
                      {selectedExpense.status}
                    </span>
                  </div>
                  <h2 className="text-3xl font-heading font-bold text-white mb-2">{selectedExpense.description || 'General Expense'}</h2>
                  <p className="text-slate-400">Paid by <span className="text-white font-medium">{selectedExpense.paidByName}</span></p>
                  
                  <div className="mt-6 p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Total Amount</span>
                    <span className="text-3xl font-heading font-bold text-white">₹{selectedExpense.totalAmount}</span>
                  </div>
                </div>

                <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  {parseFloat(selectedExpense.sharedAmount) > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Shared Breakdown (₹{selectedExpense.sharedAmount})</h4>
                      <div className="space-y-2">
                        {selectedExpense.sharedParticipants?.map((p: any, i: number) => (
                          <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
                            <span className="text-slate-300">{p.name}</span>
                            <span className="font-medium text-white">₹{p.share}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedExpense.personalExpenses && selectedExpense.personalExpenses.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Personal Items</h4>
                      <div className="space-y-2">
                        {selectedExpense.personalExpenses.map((p: any, i: number) => (
                          <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
                            <span className="text-slate-300">{p.name}</span>
                            <span className="font-medium text-white">₹{p.share}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedExpense.itemsBreakdown && selectedExpense.itemsBreakdown.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Itemized Breakdown</h4>
                      <div className="space-y-2">
                        {selectedExpense.itemsBreakdown.map((item: string, i: number) => (
                          <div key={i} className="flex items-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
                            <span className="text-slate-300 text-sm">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Admin Edit Panel (/sabo/ace) */}
                  {isAdmin && (
                    <div className="pt-6 border-t border-purple-500/20 space-y-4 bg-purple-950/10 p-4 rounded-2xl border">
                      <h4 className="text-xs font-bold text-purple-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> Admin Controls (/sabo/ace)
                      </h4>

                      {/* Change Date/Time */}
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5 font-medium">Change Date & Time</label>
                        <input
                          type="datetime-local"
                          value={editDateValue}
                          onChange={(e) => setEditDateValue(e.target.value)}
                          className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      {/* Replace Image */}
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5 font-medium">Replace Image / Receipt</label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setEditImageFile(e.target.files?.[0] || null)}
                          className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-purple-500/20 file:text-purple-300 hover:file:bg-purple-500/30"
                        />
                        {editImageFile && (
                          <p className="text-xs text-emerald-400 mt-1">New image selected: {editImageFile.name}</p>
                        )}
                      </div>

                      <button
                        onClick={handleSaveAdminEdits}
                        className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-sm rounded-xl transition-all shadow-lg shadow-purple-500/20"
                      >
                        Save Admin Changes
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

function MetricCard({ title, value, icon, delay }: { title: string, value: string, icon: React.ReactNode, delay: number }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="relative overflow-hidden bg-white/[0.02] backdrop-blur-xl rounded-3xl border border-white/10 p-6 group hover:-translate-y-1 transition-all duration-300"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative flex justify-between items-start">
        <div>
          <p className="text-slate-400 text-sm font-medium mb-1">{title}</p>
          <h3 className="text-3xl font-heading font-bold text-white tracking-tight">{value}</h3>
        </div>
        <div className="p-3 bg-white/5 rounded-2xl shadow-inner border border-white/5 group-hover:scale-110 transition-transform">
          {icon}
        </div>
      </div>
    </motion.div>
  );
}
