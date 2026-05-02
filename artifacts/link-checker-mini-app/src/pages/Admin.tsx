import { useState } from "react";
import { useGetAdminReports, useUpdateReportStatus } from "@workspace/api-client-react";
import { useTelegram } from "@/lib/telegram";
import { ShieldAlert, ShieldCheck, Clock, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ADMIN_TELEGRAM_ID = "1397648029";

export default function AdminPage() {
  const { telegramUserId } = useTelegram();
  const isAdmin = telegramUserId === ADMIN_TELEGRAM_ID;

  const { data, isLoading, refetch, isRefetching } = useGetAdminReports({
    query: { enabled: isAdmin, refetchOnWindowFocus: true },
  });

  const updateStatus = useUpdateReportStatus();
  const [processing, setProcessing] = useState<number | null>(null);
  const [done, setDone] = useState<Record<number, "confirmed" | "dismissed">>({});

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
          <ShieldAlert size={32} className="text-destructive" />
        </div>
        <h2 className="text-xl font-bold">Нет доступа</h2>
        <p className="text-muted-foreground text-sm">Этот раздел только для администратора.</p>
      </div>
    );
  }

  const handleAction = (id: number, status: "confirmed" | "dismissed") => {
    setProcessing(id);
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          setDone((prev) => ({ ...prev, [id]: status }));
          setProcessing(null);
          void refetch();
        },
        onError: () => setProcessing(null),
      }
    );
  };

  const pendingReports = (data?.reports ?? []).filter((r) => !done[r.id]);

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Репорты</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Загрузка..." : `${data?.pendingCount ?? 0} ожидают проверки`}
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isRefetching}
          className="p-2 rounded-full hover:bg-muted transition-colors"
        >
          <RefreshCw size={18} className={isRefetching ? "animate-spin text-primary" : "text-muted-foreground"} />
        </button>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-muted/50 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && pendingReports.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-14 h-14 bg-[#10b981]/10 rounded-full flex items-center justify-center">
            <ShieldCheck size={28} className="text-[#10b981]" />
          </div>
          <p className="font-medium">Всё проверено!</p>
          <p className="text-muted-foreground text-sm">Новых репортов нет.</p>
        </div>
      )}

      {/* Reports list */}
      <AnimatePresence initial={false}>
        {pendingReports.map((report) => {
          const isProcessing = processing === report.id;
          const result = done[report.id];
          const date = new Date(report.reportedAt).toLocaleDateString("ru-RU", {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          });

          return (
            <motion.div
              key={report.id}
              initial={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-card border border-border rounded-2xl p-4 space-y-3 overflow-hidden"
            >
              {/* Report ID + date */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  #{report.id}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock size={11} />
                  {date}
                </span>
              </div>

              {/* URL */}
              <div className="bg-muted/50 rounded-lg px-3 py-2">
                <p className="text-xs text-muted-foreground mb-0.5">Ссылка</p>
                <p className="text-sm font-medium break-all leading-snug">{report.url}</p>
              </div>

              {/* Reporter */}
              <p className="text-xs text-muted-foreground">
                От:{" "}
                <span className="font-medium text-foreground">
                  {report.reportedByUsername ? `@${report.reportedByUsername}` : `ID ${report.reportedByTelegramId}`}
                </span>
              </p>

              {/* Action buttons */}
              {result ? (
                <div className={`flex items-center gap-2 text-sm font-medium ${result === "confirmed" ? "text-[#ef4444]" : "text-muted-foreground"}`}>
                  {result === "confirmed" ? <ShieldAlert size={16} /> : <XCircle size={16} />}
                  {result === "confirmed" ? "Опасная ссылка подтверждена" : "Репорт отклонён"}
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(report.id, "confirmed")}
                    disabled={isProcessing}
                    className="flex-1 h-10 bg-destructive/10 text-destructive font-medium text-sm rounded-xl flex items-center justify-center gap-1.5 active:opacity-70 transition-opacity disabled:opacity-40"
                  >
                    <ShieldAlert size={15} />
                    Опасная
                  </button>
                  <button
                    onClick={() => handleAction(report.id, "dismissed")}
                    disabled={isProcessing}
                    className="flex-1 h-10 bg-muted text-muted-foreground font-medium text-sm rounded-xl flex items-center justify-center gap-1.5 active:opacity-70 transition-opacity disabled:opacity-40"
                  >
                    <CheckCircle2 size={15} />
                    Отклонить
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
