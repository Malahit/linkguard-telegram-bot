import { useState } from "react";
import { useTelegram } from "@/lib/telegram";
import { useGetLinkHistory, getGetLinkHistoryQueryKey } from "@workspace/api-client-react";
import { ShieldCheck, ShieldAlert, AlertOctagon, HelpCircle } from "lucide-react";
import { Verdict } from "@workspace/api-client-react/src/generated/api.schemas";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export default function HistoryPage() {
  const { telegramUserId } = useTelegram();
  const [filter, setFilter] = useState<Verdict | "all">("all");

  const { data: history, isLoading } = useGetLinkHistory(
    { telegramUserId },
    { query: { enabled: !!telegramUserId, queryKey: getGetLinkHistoryQueryKey({ telegramUserId }) } }
  );

  const filteredItems = history?.items.filter(item => filter === "all" || item.verdict === filter) || [];

  return (
    <div className="px-5 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">История</h1>
        <p className="text-muted-foreground text-sm mt-1">Все твои проверенные ссылки</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-5 px-5">
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")} label="Все" />
        <FilterButton active={filter === "danger"} onClick={() => setFilter("danger")} label="Опасные" color="text-[#ef4444]" />
        <FilterButton active={filter === "caution"} onClick={() => setFilter("caution")} label="Подозрительные" color="text-[#f59e0b]" />
        <FilterButton active={filter === "safe"} onClick={() => setFilter("safe")} label="Безопасные" color="text-[#10b981]" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-20 bg-card rounded-xl animate-pulse"></div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-16 px-4">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground">
            <Clock size={24} />
          </div>
          <p className="text-foreground font-medium">Ещё ни одной проверки</p>
          <p className="text-sm text-muted-foreground mt-1">Вставь ссылку на главном экране и проверь её!</p>
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {filteredItems.map(item => (
            <div key={item.id} className="bg-card border border-border p-4 rounded-xl flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-1 ${
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
                <p className="text-[15px] font-medium truncate text-foreground leading-tight mb-1">{item.url}</p>
                <p className="text-[13px] text-muted-foreground line-clamp-2 leading-snug mb-2">{item.explanation}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{format(new Date(item.checkedAt), "d MMM, HH:mm", { locale: ru })}</span>
                  {item.reportedToParent && (
                    <>
                      <span>•</span>
                      <span className="text-primary font-medium">Отправлено взрослому</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, label, color }: { active: boolean, onClick: () => void, label: string, color?: string }) {
  return (
    <button 
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
        active 
          ? "bg-foreground text-background" 
          : "bg-card border border-border text-foreground hover:bg-muted"
      }`}
    >
      <span className={active ? "" : color}>{label}</span>
    </button>
  );
}

import { Clock } from "lucide-react";