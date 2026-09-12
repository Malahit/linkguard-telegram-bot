import { Router, type IRouter } from "express";
import { handleUpdate, type TelegramUpdate } from "../lib/telegram-bot";

const router: IRouter = Router();

router.post("/webhook/telegram", async (req, res): Promise<void> => {
  const update = req.body as TelegramUpdate;

  // Отвечаем Telegram сразу — иначе будет retry через 1 сек
  res.sendStatus(200);

  // Обрабатываем update в фоне
  void handleUpdate(update);
});

export default router;
