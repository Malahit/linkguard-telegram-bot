# LinkGuard — Telegram Mini App

> Личный помощник подростка по безопасному открытию ссылок

Telegram Mini App для проверки ссылок на фишинг, вредоносность и подозрительные сайты. Не родительский контроль — это твой персональный помощник.

## Стек

- **Frontend**: React + Vite + TypeScript (Telegram Mini App)
- **Backend**: Node.js + Express 5 + TypeScript
- **База данных**: PostgreSQL + Drizzle ORM
- **Валидация**: Zod
- **API codegen**: Orval (OpenAPI-first)

## Вердикты

- ✅ **Безопасно** — сайт выглядит надёжным
- ⚠️ **Осторожно** — есть подозрительные признаки
- 🚫 **Опасно** — сайт помечен как вредоносный
- ❓ **Неизвестно** — недостаточно данных

## Быстрый старт

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/link-checker-mini-app run dev
```

## Переменные окружения

```env
DATABASE_URL=postgresql://...
GOOGLE_SAFE_BROWSING_API_KEY=  # опционально, для Google Web Risk API
```
