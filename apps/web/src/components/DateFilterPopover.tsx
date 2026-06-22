import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarBlank, CaretDown, X, Funnel } from '@phosphor-icons/react';

export interface DateFilterState {
  dateFrom?: string;
  dateTo?: string;
  filterDay?: string;
  filterMonth?: string;
  filterYear?: string;
}

interface DateFilterPopoverProps {
  filterState: DateFilterState;
  onChange: (state: DateFilterState) => void;
}

export default function DateFilterPopover({ filterState, onChange }: DateFilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'range' | 'custom'>('range');

  const { dateFrom, dateTo, filterDay, filterMonth, filterYear } = filterState;

  // Local state for the inputs to avoid updating before "Terapkan" is clicked, or update instantly
  // Since the previous implementation updated instantly, we will keep instant updates for better UX,
  // except for the custom inputs we can apply them dynamically as well.

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleQuickSelect = (type: 'this_month' | 'last_month' | 'this_year' | 'all') => {
    const today = new Date();
    if (type === 'this_month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      onChange({ dateFrom: firstDay.toISOString().split('T')[0], dateTo: lastDay.toISOString().split('T')[0] });
    } else if (type === 'last_month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      onChange({ dateFrom: firstDay.toISOString().split('T')[0], dateTo: lastDay.toISOString().split('T')[0] });
    } else if (type === 'this_year') {
      const firstDay = new Date(today.getFullYear(), 0, 1);
      const lastDay = new Date(today.getFullYear(), 11, 31);
      onChange({ dateFrom: firstDay.toISOString().split('T')[0], dateTo: lastDay.toISOString().split('T')[0] });
    } else if (type === 'all') {
      onChange({});
    }
    setIsOpen(false);
  };

  const getDisplayText = () => {
    // If Custom is active
    if (filterDay || filterMonth || filterYear) {
      const parts: string[] = [];
      if (filterDay) parts.push(`Tgl ${filterDay}`);
      if (filterMonth) parts.push(`Bln ${filterMonth}`);
      if (filterYear) parts.push(`Thn ${filterYear}`);
      return parts.join(' ');
    }

    // If Range is active
    if (!dateFrom && !dateTo) return 'Semua Waktu';
    const format = (d: string) => new Date(d).toLocaleDateString('id-ID', { month: 'short', year: 'numeric', day: 'numeric' });
    if (dateFrom && dateTo) return `${format(dateFrom)} - ${format(dateTo)}`;
    if (dateFrom) return `Mulai ${format(dateFrom)}`;
    if (dateTo) return `Sampai ${format(dateTo)}`;
    
    return 'Filter Waktu';
  };

  const isActive = Boolean(dateFrom || dateTo || filterDay || filterMonth || filterYear);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-3 border rounded-full transition-all outline-none shadow-sm text-sm font-medium ${
          isActive 
            ? 'bg-primary-50 border-primary-200 text-primary-700' 
            : 'bg-white border-slate-200/50 text-zinc-700 hover:bg-zinc-50'
        }`}
      >
        <CalendarBlank weight={isActive ? "fill" : "regular"} className="w-4 h-4" />
        <span className="truncate max-w-[200px]">{getDisplayText()}</span>
        {isActive ? (
          <div 
            onClick={(e) => { e.stopPropagation(); onChange({}); }}
            className="p-0.5 hover:bg-primary-100 rounded-full cursor-pointer ml-1"
          >
            <X className="w-3 h-3" />
          </div>
        ) : (
          <CaretDown className="w-3 h-3 text-zinc-400" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden"
          >
            {/* Mode Switcher */}
            <div className="flex border-b border-slate-100">
              <button 
                onClick={() => setMode('range')} 
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${mode === 'range' ? 'text-primary-600 border-b-2 border-primary-500 bg-primary-50/50' : 'text-zinc-400 hover:text-zinc-600 hover:bg-slate-50'}`}
              >
                Rentang Waktu
              </button>
              <button 
                onClick={() => setMode('custom')} 
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${mode === 'custom' ? 'text-primary-600 border-b-2 border-primary-500 bg-primary-50/50' : 'text-zinc-400 hover:text-zinc-600 hover:bg-slate-50'}`}
              >
                Custom
              </button>
            </div>

            {mode === 'range' ? (
              <>
                <div className="p-4 border-b border-slate-50 flex gap-2 overflow-x-auto hide-scrollbar">
                  <button onClick={() => handleQuickSelect('this_month')} className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors">Bulan Ini</button>
                  <button onClick={() => handleQuickSelect('last_month')} className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors">Bulan Lalu</button>
                  <button onClick={() => handleQuickSelect('this_year')} className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors">Tahun Ini</button>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 mb-1.5 uppercase tracking-wider">Dari Tanggal</label>
                    <input 
                      type="date"
                      value={dateFrom || ''}
                      onChange={(e) => onChange({ ...filterState, dateFrom: e.target.value, filterDay: '', filterMonth: '', filterYear: '' })}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none text-sm text-zinc-700 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 mb-1.5 uppercase tracking-wider">Sampai Tanggal</label>
                    <input 
                      type="date"
                      value={dateTo || ''}
                      onChange={(e) => onChange({ ...filterState, dateTo: e.target.value, filterDay: '', filterMonth: '', filterYear: '' })}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none text-sm text-zinc-700 transition-all"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="p-4 space-y-4">
                <div className="p-3 bg-blue-50 text-blue-800 text-xs rounded-lg border border-blue-100 flex gap-2">
                  <Funnel className="w-4 h-4 shrink-0 mt-0.5" weight="fill" />
                  <p>Mencari tanggal spesifik dari bulan atau tahun kapanpun. Kosongkan jika tidak relevan.</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 mb-1.5 uppercase tracking-wider">Tanggal</label>
                    <input 
                      type="number"
                      placeholder="1-31"
                      min="1" max="31"
                      value={filterDay || ''}
                      onChange={(e) => onChange({ ...filterState, filterDay: e.target.value, dateFrom: '', dateTo: '' })}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none text-sm text-zinc-700 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 mb-1.5 uppercase tracking-wider">Bulan</label>
                    <input 
                      type="number"
                      placeholder="1-12"
                      min="1" max="12"
                      value={filterMonth || ''}
                      onChange={(e) => onChange({ ...filterState, filterMonth: e.target.value, dateFrom: '', dateTo: '' })}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none text-sm text-zinc-700 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 mb-1.5 uppercase tracking-wider">Tahun</label>
                    <input 
                      type="number"
                      placeholder="YYYY"
                      value={filterYear || ''}
                      onChange={(e) => onChange({ ...filterState, filterYear: e.target.value, dateFrom: '', dateTo: '' })}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none text-sm text-zinc-700 transition-all"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="p-3 bg-slate-50 flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
              >
                Tutup
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
