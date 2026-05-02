import { motion } from "framer-motion";
import { ExternalLink, Shield, Eye, Lock, Wifi, AlertTriangle, Users } from "lucide-react";

const OPENCLAW_CHANNEL = "https://t.me/openclaw";

const HYGIENE_TIPS = [
  {
    icon: Shield,
    title: "Проверяй ссылки перед открытием",
    body: "Особенно если получил их от незнакомцев или в спаме. Одна опасная ссылка может скомпрометировать весь аккаунт.",
  },
  {
    icon: Lock,
    title: "Сильный пароль — не дата рождения",
    body: "Используй длинные пароли из случайных слов. Разные пароли для разных сайтов. Менеджер паролей — твой друг.",
  },
  {
    icon: Eye,
    title: "Двухфакторная аутентификация",
    body: "Включи её везде, где это возможно — особенно в Telegram, VK и почте. Код из SMS — второй замок на двери.",
  },
  {
    icon: Wifi,
    title: "Осторожно с публичным Wi-Fi",
    body: "В кафе и транспорте не вводи пароли и не заходи в банки. Открытые сети могут перехватывать данные.",
  },
  {
    icon: AlertTriangle,
    title: "Фишинг — самая частая атака",
    body: "Мошенники делают точные копии сайтов банков и соцсетей. Всегда смотри на адрес сайта в строке браузера.",
  },
  {
    icon: Users,
    title: "Настройки приватности",
    body: "Проверь кто видит твой номер, фото и геолокацию в настройках каждого приложения. Меньше данных — меньше рисков.",
  },
];

export default function AboutPage() {
  return (
    <div className="px-5 py-6 space-y-8 pb-10">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-black text-lg select-none">OC</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">OpenClaw</h1>
            <p className="text-sm text-muted-foreground">Цифровая безопасность для всех</p>
          </div>
        </div>

        <p className="text-[15px] text-foreground leading-relaxed">
          OpenClaw — это проект о цифровой гигиене. Мы объясняем подросткам и взрослым, как безопасно жить в интернете: без страха, но с умом.
        </p>

        <motion.a
          href={OPENCLAW_CHANNEL}
          target="_blank"
          rel="noopener noreferrer"
          whileTap={{ scale: 0.97 }}
          className="flex items-center justify-between w-full bg-primary text-primary-foreground rounded-2xl px-5 py-4 active:opacity-80"
        >
          <div>
            <p className="font-semibold text-[15px]">Telegram-канал OpenClaw</p>
            <p className="text-[12px] opacity-80 mt-0.5">Советы, новости, разборы угроз</p>
          </div>
          <ExternalLink size={20} className="shrink-0 opacity-80" />
        </motion.a>
      </motion.div>

      {/* What is this app */}
      <section className="space-y-3">
        <h2 className="font-bold text-[17px]">Что такое этот бот?</h2>
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3 text-[14px] text-muted-foreground leading-relaxed">
          <p>
            Этот мини-апп — <span className="text-foreground font-medium">личный помощник по безопасным ссылкам</span>. Не слежка и не родительский контроль.
          </p>
          <p>
            Ты сам решаешь, что проверять. Никто не получает уведомлений без твоего разрешения. Кнопка «Показать взрослому» — только если захочешь сам.
          </p>
          <p>
            Проверка использует Google Web Risk API и собственный анализ: смотрим на структуру ссылки, домен, паттерны фишинга.
          </p>
        </div>
      </section>

      {/* Digital hygiene tips */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-[17px]">Цифровая гигиена</h2>
          <a
            href={OPENCLAW_CHANNEL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-primary font-medium"
          >
            Больше в канале
          </a>
        </div>

        <div className="space-y-3">
          {HYGIENE_TIPS.map((tip, i) => {
            const Icon = tip.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="bg-card border border-border rounded-2xl p-4 flex gap-3"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={18} />
                </div>
                <div className="space-y-1">
                  <p className="text-[14px] font-semibold text-foreground">{tip.title}</p>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{tip.body}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <div className="text-center pt-2">
        <p className="text-[11px] text-muted-foreground">
          OpenClaw — открытый проект о цифровой безопасности
        </p>
        <a
          href="https://github.com/Malahit/linkguard-telegram-bot"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary mt-1 block"
        >
          Исходный код на GitHub
        </a>
      </div>
    </div>
  );
}
