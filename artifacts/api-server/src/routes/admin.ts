import { Router, type IRouter } from "express";
import { sendToChannel } from "../lib/telegram-bot";
import { getPostForDay, formatPost } from "../lib/posts-pool";
import { getPendingReports, getPendingCount, updateReportStatus } from "../lib/report-store";

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

router.get("/admin/reports", async (_req, res): Promise<void> => {
  const [reports, pendingCount] = await Promise.all([
    getPendingReports(50),
    getPendingCount(),
  ]);
  res.json({ pendingCount, reports });
});

router.patch("/admin/reports/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const { status } = req.body as { status: string };

  if (!id || !["reviewed", "confirmed", "dismissed"].includes(status)) {
    res.status(400).json({ success: false, id, status, message: "Invalid id or status" });
    return;
  }

  const ok = await updateReportStatus(id, status as "reviewed" | "confirmed" | "dismissed");
  if (ok) {
    res.json({ success: true, id, status });
  } else {
    res.status(500).json({ success: false, id, status, message: "Failed to update" });
  }
});

export default router;
