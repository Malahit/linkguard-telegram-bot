import { Router, type IRouter } from "express";
import { sendToChannel } from "../lib/telegram-bot";
import { getPostForDay, formatPost } from "../lib/posts-pool";

const router: IRouter = Router();

router.post("/admin/test-post", async (req, res): Promise<void> => {
  const post = getPostForDay();
  const text = formatPost(post);
  const ok = await sendToChannel(text);

  if (ok) {
    res.json({ success: true, message: "Тестовый пост отправлен в канал!", title: post.title });
  } else {
    res.status(500).json({ success: false, message: "Не удалось отправить. Проверь TELEGRAM_BOT_TOKEN и OPENCLAW_CHANNEL_ID." });
  }
});

export default router;
