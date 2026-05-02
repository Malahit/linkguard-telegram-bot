import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useTelegram } from "@/lib/telegram";
import { useCheckLink, useReportToParent } from "@workspace/api-client-react";
import { ShieldCheck, ShieldAlert, AlertOctagon, HelpCircle, ArrowLeft, Send, Share2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const VERDICT_CONFIG = {
  safe:    { icon: ShieldCheck,  color: "text-[#10b981]", bgColor: "bg-[#10b981]", label: "✅ Безопасно",   shareEmoji: "✅" },
  caution: { icon: AlertOctagon, color: "text-[#f59e0b]", bgColor: "bg-[#f59e0b]", label: "⚠️ Осторожно",  shareEmoji: "⚠️" },
  danger:  { icon: ShieldAlert,  color: "text-[#ef4444]", bgColor: "bg-[#ef4444]", label: "🚫 Опасно",     shareEmoji: "🚫" },
  unknown: { icon: HelpCircle,   color: "text-gray-500",  bgColor: "bg-gray-500",  label: "❓ Неизвестно", shareEmoji: "❓" },
} as const;

export default function ResultPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const urlToCheck = new URLSearchParams(searchString).get("url");
  const { telegramUserId } = useTelegram();
  const checkLink = useCheckLink();
  const reportToParent = useReportToParent();

  const [hasReported, setHasReported] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (urlToCheck && telegramUserId && !checkLink.data && !checkLink.isPending && !checkLink.isError) {
      checkLink.mutate({ data: { url: urlToCheck, telegramUserId } });
    }
  }, [urlToCheck, telegramUserId]);

  if (!urlToCheck) {
    setLocation("/");
    return null;
  }

  if (checkLink.isPending) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-4 min-h-[400px]">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground font-medium animate-pulse">Проверяем ссылку...</p>
      </div>
    );
  }

  if (checkLink.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6 min-h-[400px]">
        <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center">
          <AlertOctagon size={32} />
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2">Что-то пошло не так</h2>
          <p className="text-muted-foreground text-sm">Не удалось проверить ссылку. Попробуй ещё раз.</p>
        </div>
        <button onClick={() => setLocation("/")} className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium">
          Вернуться назад
        </button>
      </div>
    );
  }

  const result = checkLink.data;
  if (!result) return null;

  const config = VERDICT_CONFIG[result.verdict];
  const Icon = config.icon;

  const handleReport = () => {
    reportToParent.mutate(
      { data: { linkCheckId: result.id, telegramUserId } },
      { onSuccess: () => setHasReported(true) }
    );
  };

  const handleShare = () => {
    const domain = (() => {
      try { return new URL(result.normalizedUrl.startsWith("http") ? result.normalizedUrl : `https://${result.normalizedUrl}`).hostname; }
      catch { return result.normalizedUrl; }
    })();

    const text =
      `${config.shareEmoji} Проверил ссылку через OpenClaw\n\n` +
      `Домен: ${domain}\n` +
      `Вердикт: ${config.label}\n\n` +
      `${result.explanation}\n\n` +
      `🔗 Проверяй свои ссылки: @bezstrahavseti`;

    const tg = (window as any).Telegram?.WebApp;

    // Native Telegram share sheet (works inside Mini App)
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent("https://t.me/bezstrahavseti")}&text=${encodeURIComponent(text)}`
      );
    } else {
      // Fallback for browser / dev environment
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent("https://t.me/bezstrahavseti")}&text=${encodeURIComponent(text)}`,
        "_blank"
      );
    }

    setShared(true);
    setTimeout(() => setShared(false), 2500);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="pt-safe px-4 py-4 flex items-center">
        <button
          onClick={() => setLocation("/")}
          className="p-2 -ml-2 rounded-full hover:bg-muted text-foreground"
        >
          <ArrowLeft size={24} />
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="flex-1 px-5 flex flex-col items-center pt-6 space-y-7"
      >
        {/* Verdict icon */}
        <div className={`w-28 h-28 rounded-full ${config.bgColor}/10 flex items-center justify-center ${config.color}`}>
          <Icon size={56} strokeWidth={2} />
        </div>

        {/* Verdict details */}
        <div className="text-center space-y-3 max-w-[300px]">
          <h1 className="text-2xl font-bold">{config.label}</h1>
          <div className="bg-card border border-border px-3 py-2 rounded-lg text-sm font-medium text-foreground truncate w-full shadow-sm">
            {result.normalizedUrl}
          </div>
          <p className="text-muted-foreground text-[15px] leading-relaxed">
            {result.explanation}
          </p>
        </div>

        {/* Actions */}
        <div className="w-full max-w-[320px] space-y-3 mt-auto mb-10">
          <button
            onClick={() => setLocation("/")}
            className="w-full h-14 bg-primary text-primary-foreground font-semibold rounded-xl active:scale-[0.98] transition-all"
          >
            Проверить ещё
          </button>

          {/* Share button */}
          <motion.button
            onClick={handleShare}
            whileTap={{ scale: 0.97 }}
            className="w-full h-14 bg-card border border-border text-foreground font-medium rounded-xl flex items-center justify-center gap-2 active:opacity-80 transition-all relative overflow-hidden"
          >
            <AnimatePresence mode="wait">
              {shared ? (
                <motion.span
                  key="shared"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 text-[#10b981]"
                >
                  ✓ Поделился!
                </motion.span>
              ) : (
                <motion.span
                  key="share"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2"
                >
                  <Share2 size={18} />
                  Поделиться результатом
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>

          {/* Report to parent */}
          <button
            onClick={handleReport}
            disabled={hasReported || reportToParent.isPending}
            className="w-full h-14 bg-secondary text-secondary-foreground font-medium rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Send size={18} />
            {hasReported ? "Отправлено" : "Показать взрослому"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
