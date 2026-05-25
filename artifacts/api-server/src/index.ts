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

  // Register Telegram webhook from env (works on VPS and any hosting)
  const webhookUrl = process.env["TELEGRAM_WEBHOOK_URL"];
  if (webhookUrl) {
    void setupBot(webhookUrl);
  } else {
    // Fallback: try Replit-style domain discovery
    const domains = process.env["REPLIT_DOMAINS"];
    if (domains) {
      const domain = domains.split(",")[0];
      const replitWebhookUrl = `https://${domain}/api/webhook/telegram`;
      void setupBot(replitWebhookUrl);
    } else {
      logger.warn(
        "TELEGRAM_WEBHOOK_URL not set and REPLIT_DOMAINS not set — Telegram webhook not configured"
      );
    }
  }
});
