import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { setupBot } from "./lib/telegram-bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();

  // Настраиваем Telegram webhook + команды + кнопку меню
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const domain = domains.split(",")[0];
    const webhookUrl = `https://${domain}/api/webhook/telegram`;
    void setupBot(webhookUrl);
  } else {
    logger.warn("REPLIT_DOMAINS not set — Telegram webhook not configured");
  }
});
