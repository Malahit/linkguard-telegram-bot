import { useState } from "react";
import { useLocation } from "wouter";
import { useTelegram } from "@/lib/telegram";
import { useCheckLink, useGetLinkStats, getGetLinkStatsQueryKey, useGetLinkHistory, getGetLinkHistoryQueryKey } from "@workspace/api-client-react";
import { Search, ShieldCheck, ShieldAlert, AlertOctagon, HelpCircle, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";

const OPENCLAW_CHANNEL = "https://t.me/openclaw";

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [, setLocation] = useLocation();
  const { telegramUserId, user } = useTelegram();
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
    setLocation(`/result?url=${encodeURIComponent(url)}`);
  };

  const greeting = user?.first_name ? `Привет, ${user.first_name}!` : "Привет!";

  return (
    <div className="px-5 py-5 space-y-7">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{greeting} 👋</h1>
        <p className="text-muted-foreground text-sm">
          Вставь ссылку — проверю за секунду.
        </p>
      </div>

      <form onSubmit={handleCheck} className="space-y-3">
        <div className="relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-muted-foreground" />
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full h-14 pl-12 pr-4 rounded-2xl bg-card border border-border shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-sm"
            required
          />
        </div>
        <motion.button
          type="submit"
          disabled={!url.trim() || checkLink.isPending}
          whileTap={{ scale: 0.97 }}
          className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl disabled:opacity-50 transition-opacity"
        >
          Проверить ссылку
        </motion.button>
      </form>

      {stats && stats.totalChecked > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-2"
        >
          <StatCard value={stats.totalChecked} label="Проверено" color="text-primary" />
          <StatCard value={stats.safeCount} label="Безопасных" color="text-[#10b981]" />
          <StatCard value={stats.dangerCount + stats.cautionCount} label="Опасных" color="text-[#ef4444]" />
        </motion.div>
      )}

      {history?.items && history.items.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground px-1">Недавние проверки</h2>
          <div className="space-y-2">
            {history.items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="bg-card border border-border p-3 rounded-xl flex items-center gap-3"
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  item.verdict === 'safe' ? 'bg-[#10b981]/10 text-[#10b981]' :
                  item.verdict === 'caution' ? 'bg-[#f59e0b]/10 text-[#f59e0b]' :
                  item.verdict === 'danger' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {item.verdict === 'safe' && <ShieldCheck size={18} />}
                  {item.verdict === 'caution' && <AlertOctagon size={18} />}
                  {item.verdict === 'danger' && <ShieldAlert size={18} />}
                  {item.verdict === 'unknown' && <HelpCircle size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.url}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.explanation}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* OpenClaw channel promo */}
      <motion.a
        href={OPENCLAW_CHANNEL}
        target="_blank"
        rel="noopener noreferrer"
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-2xl p-4 active:opacity-80 transition-opacity"
      >
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-black text-xs">OC</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Канал OpenClaw</p>
          <p className="text-xs text-muted-foreground">Цифровая гигиена — просто и понятно</p>
        </div>
        <ExternalLink size={16} className="text-primary shrink-0" />
      </motion.a>
    </div>
  );
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-card border border-border p-3 rounded-2xl flex flex-col items-center text-center">
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</span>
    </div>
  );
}
