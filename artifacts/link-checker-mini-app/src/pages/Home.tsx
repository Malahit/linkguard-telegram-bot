import { useState } from "react";
import { useLocation } from "wouter";
import { useTelegram } from "@/lib/telegram";
import { useCheckLink, useGetLinkStats, getGetLinkStatsQueryKey, useGetLinkHistory, getGetLinkHistoryQueryKey } from "@workspace/api-client-react";
import { Search, ShieldCheck, ShieldAlert, AlertOctagon, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [, setLocation] = useLocation();
  const { telegramUserId } = useTelegram();
  const checkLink = useCheckLink();
  
  const { data: stats } = useGetLinkStats({ telegramUserId }, {
    query: { enabled: !!telegramUserId, queryKey: getGetLinkStatsQueryKey({ telegramUserId }) }
  });

  const { data: history } = useGetLinkHistory({ telegramUserId, limit: 3 }, {
    query: { enabled: !!telegramUserId, queryKey: getGetLinkHistoryQueryKey({ telegramUserId, limit: 3 }) }
  });

  const handleCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    // We navigate to result page with the URL in state, so result page can do the check.
    // Or we do check here and pass result via a state manager or just URL param.
    // Let's encode URL and send it to /result.
    setLocation(`/result?url=${encodeURIComponent(url)}`);
  };

  return (
    <div className="px-5 py-6 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Привет! 👋</h1>
        <p className="text-muted-foreground text-sm">Вставь ссылку, а я проверю её на безопасность.</p>
      </div>

      <form onSubmit={handleCheck} className="relative">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-muted-foreground" />
        </div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="w-full h-14 pl-12 pr-4 rounded-2xl bg-card border border-border shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
          required
        />
        <button
          type="submit"
          disabled={!url.trim()}
          className="mt-4 w-full h-12 bg-primary text-primary-foreground font-medium rounded-xl disabled:opacity-50 transition-opacity active:scale-[0.98]"
        >
          Проверить ссылку
        </button>
      </form>

      {stats && stats.totalChecked > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card border border-border p-4 rounded-2xl flex flex-col items-center text-center">
            <span className="text-3xl font-bold text-primary">{stats.totalChecked}</span>
            <span className="text-xs text-muted-foreground mt-1">Всего проверено</span>
          </div>
          <div className="bg-card border border-border p-4 rounded-2xl flex flex-col items-center text-center">
            <span className="text-3xl font-bold text-[#10b981]">{stats.safeCount}</span>
            <span className="text-xs text-muted-foreground mt-1">Безопасных</span>
          </div>
        </div>
      )}

      {history?.items && history.items.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground px-1">Недавние проверки</h2>
          <div className="space-y-2">
            {history.items.map(item => (
              <div key={item.id} className="bg-card border border-border p-3 rounded-xl flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  item.verdict === 'safe' ? 'bg-[#10b981]/10 text-[#10b981]' :
                  item.verdict === 'caution' ? 'bg-[#f59e0b]/10 text-[#f59e0b]' :
                  item.verdict === 'danger' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
                  'bg-gray-500/10 text-gray-500'
                }`}>
                  {item.verdict === 'safe' && <ShieldCheck size={20} />}
                  {item.verdict === 'caution' && <AlertOctagon size={20} />}
                  {item.verdict === 'danger' && <ShieldAlert size={20} />}
                  {item.verdict === 'unknown' && <HelpCircle size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.url}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.explanation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
