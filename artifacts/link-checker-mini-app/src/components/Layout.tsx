import { Link, useLocation } from "wouter";
import { Home, Clock, Settings, BookOpen } from "lucide-react";
import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-[430px] mx-auto relative overflow-hidden bg-background">
      <AppHeader />
      <main className="flex-1 overflow-y-auto pb-[80px]">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

function AppHeader() {
  const [location] = useLocation();
  if (location === "/result") return null;

  return (
    <header className="shrink-0 h-14 px-5 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm z-40">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-black text-sm select-none">OC</span>
        </div>
        <div className="leading-none">
          <span className="font-bold text-[15px] text-foreground tracking-tight">OpenClaw</span>
          <span className="block text-[10px] text-muted-foreground font-normal">цифровая безопасность</span>
        </div>
      </div>
      <a
        href="https://t.me/openclaw"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] font-medium text-primary bg-primary/10 px-3 py-1.5 rounded-full active:opacity-70 transition-opacity"
      >
        Наш канал
      </a>
    </header>
  );
}

function BottomNav() {
  const [location] = useLocation();

  const navItems = [
    { path: "/", icon: Home, label: "Главная" },
    { path: "/history", icon: Clock, label: "История" },
    { path: "/about", icon: BookOpen, label: "О проекте" },
    { path: "/settings", icon: Settings, label: "Настройки" },
  ];

  if (location === "/result") return null;

  return (
    <nav className="absolute bottom-0 w-full h-[80px] bg-card border-t border-border px-2 pb-safe pt-2 flex items-center justify-between z-50">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.path;

        return (
          <Link key={item.path} href={item.path} className="flex-1">
            <div className={`flex flex-col items-center justify-center gap-1 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}>
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[9px] font-medium">{item.label}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
