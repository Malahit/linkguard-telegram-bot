# Деплой на VPS — пошаговый гайд

> Предполагается: Ubuntu 22.04+, Docker + Docker Compose, nginx, certbot.
> Сервер: CPU 4 / RAM 8 GB / NVMe 60 GB.

---

## Шаг 0 — Предварительные требования

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # перелогинься после этого

# nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## Шаг 1 — Клонируем репо

```bash
cd ~
git clone https://github.com/Malahit/linkguard-telegram-bot.git linkguard
cd linkguard
```

---

## Шаг 2 — Заполняем `.env.production`

```bash
cp .env.production .env.production.bak  # про запас
нано nano .env.production
```

Обязательно заменить все `REPLACE_WITH_...`:

| Переменная | Где взять |
|---|---|
| `POSTGRES_PASSWORD` | придумайте сами, 20+ символов |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `OPENCLAW_CHANNEL_ID` | `@bezstrahavseti` или числовой ID |
| `VIRUSTOTAL_API_KEY` | [virustotal.com/gui/my-apikey](https://www.virustotal.com/gui/my-apikey) |

---

## Шаг 3 — Запускаем контейнеры

```bash
docker compose up -d --build

# Проверяем что всё запустилось
docker compose ps
docker compose logs api --tail 50
```

Ожидаемый статус:
```
NAME              STATUS
linkguard-api-1   Up (healthy)
linkguard-postgres-1  Up (healthy)
```

---

## Шаг 4 — Настраиваем nginx + SSL

```bash
# Копируем vhost и подставляем домен
sudo cp nginx/linkguard.conf /etc/nginx/sites-available/linkguard
sudo nano /etc/nginx/sites-available/linkguard
# Заменяем YOURDOMAIN.COM на реальный домен

sudo ln -s /etc/nginx/sites-available/linkguard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

```bash
# SSL сертификат через Let’s Encrypt
sudo certbot --nginx -d YOURDOMAIN.COM

# Проверяем автообновление
sudo certbot renew --dry-run
```

> ℹ️ Если домена ещё нет — пропусти certbot. Бот работает и без HTTPS — через Telegram Webhook не нужно.

---

## Шаг 5 — Smoke-test

```bash
# Healthcheck API
curl http://localhost:8081/health
# Ожидаем: {"status":"ok"}

# Проверить логи
# 1. Отправь боту любую ссылку — должен ответить вердиктом
# 2. Подожди 10:00 МСК — должен уйти пост в канал
```

---

## Полезные команды

```bash
# Перезапустить апи после обновления кода
docker compose up -d --build api

# Логи в реальном времени
docker compose logs -f api

# Остановить всё
docker compose down

# Сбросить базу (осторожно!)
docker compose down -v
```
