import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetUserSettingsQueryParams,
  GetUserSettingsResponse,
  UpdateUserSettingsBody,
  UpdateUserSettingsResponse,
  RegisterUserBody,
  RegisterUserResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/users/settings", async (req, res): Promise<void> => {
  const parsed = GetUserSettingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { telegramUserId } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramUserId, telegramUserId))
    .limit(1);

  if (!user) {
    res.json(
      GetUserSettingsResponse.parse({
        telegramUserId,
        parentContact: null,
        trustedDomains: [],
        notifyParentOnDanger: false,
        language: "ru",
      })
    );
    return;
  }

  res.json(
    GetUserSettingsResponse.parse({
      telegramUserId: user.telegramUserId,
      parentContact: user.parentContact ?? null,
      trustedDomains: user.trustedDomains,
      notifyParentOnDanger: user.notifyParentOnDanger,
      language: user.language,
    })
  );
});

router.put("/users/settings", async (req, res): Promise<void> => {
  const parsed = UpdateUserSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { telegramUserId, parentContact, trustedDomains, notifyParentOnDanger } = parsed.data;

  const updateData: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
  if (parentContact !== undefined) updateData.parentContact = parentContact ?? undefined;
  if (trustedDomains !== undefined) updateData.trustedDomains = trustedDomains;
  if (notifyParentOnDanger !== undefined) updateData.notifyParentOnDanger = notifyParentOnDanger;

  let [user] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.telegramUserId, telegramUserId))
    .returning();

  if (!user) {
    [user] = await db
      .insert(usersTable)
      .values({
        telegramUserId,
        firstName: telegramUserId,
        parentContact: parentContact ?? undefined,
        trustedDomains: trustedDomains ?? [],
        notifyParentOnDanger: notifyParentOnDanger ?? false,
        language: "ru",
      })
      .returning();
  }

  res.json(
    UpdateUserSettingsResponse.parse({
      telegramUserId: user.telegramUserId,
      parentContact: user.parentContact ?? null,
      trustedDomains: user.trustedDomains,
      notifyParentOnDanger: user.notifyParentOnDanger,
      language: user.language,
    })
  );
});

router.post("/users/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { telegramUserId, firstName, lastName, username } = parsed.data;

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramUserId, telegramUserId))
    .limit(1);

  let user;
  if (existing.length > 0) {
    [user] = await db
      .update(usersTable)
      .set({
        firstName,
        lastName: lastName ?? undefined,
        username: username ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.telegramUserId, telegramUserId))
      .returning();
  } else {
    [user] = await db
      .insert(usersTable)
      .values({
        telegramUserId,
        firstName,
        lastName: lastName ?? undefined,
        username: username ?? undefined,
        trustedDomains: [],
        notifyParentOnDanger: false,
        language: "ru",
      })
      .returning();
  }

  res.json(
    RegisterUserResponse.parse({
      telegramUserId: user.telegramUserId,
      firstName: user.firstName,
      lastName: user.lastName ?? null,
      username: user.username ?? null,
      createdAt: user.createdAt,
    })
  );
});

export default router;
