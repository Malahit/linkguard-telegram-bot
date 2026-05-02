import { logger } from "./logger";

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
const CHANNEL_ID = process.env["OPENCLAW_CHANNEL_ID"];

function isConfigured(): boolean {
  return !!(BOT_TOKEN && CHANNEL_ID);
}

export async function sendToChannel(text: string): Promise<boolean> {
  if (!isConfigured()) {
    logger.warn("Telegram bot not configured — TELEGRAM_BOT_TOKEN or OPENCLAW_CHANNEL_ID missing");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const data = (await res.json()) as { ok: boolean; description?: string };

    if (!data.ok) {
      logger.error({ description: data.description }, "Telegram API error");
      return false;
    }

    logger.info("Message sent to OpenClaw channel");
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send Telegram message");
    return false;
  }
}
