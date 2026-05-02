import { Link, useLocation } from "wouter";
import { Home, Clock, Settings } from "lucide-react";
import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-[430px] mx-auto relative overflow-hidden bg-background">
      <main className="flex-1 overflow-y-auto pb-[80px]">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

function BottomNav() {
  const [location] = useLocation();

  const navItems = [
    { path: "/", icon: Home, label: "Главная" },
    { path: "/history", icon: Clock, label: "История" },
    { path: "/settings", icon: Settings, label: "Настройки" }
  ];

  // Hide nav on result page
  if (location === "/result") return null;

  return (
    <nav className="absolute bottom-0 w-full h-[80px] bg-card border-t border-border px-6 pb-safe pt-2 flex items-center justify-between z-50">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.path;
        
        return (
          <Link key={item.path} href={item.path} className="flex-1">
            <div className={`flex flex-col items-center justify-center gap-1 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}>
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
