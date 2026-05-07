import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { ai } from "@workspace/integrations-gemini-ai";

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

const router = Router();

const MODEL = "gemini-3-flash-preview";

const TRADER_SYSTEM_PROMPT = `أنت مساعد تحليل تداول XAU/USD متخصص ومتقدم. أنت تعمل داخل نظام تداول مؤسسي وتمتلك صلاحيات كاملة للوصول إلى:

**أدواتك وقدراتك:**
- تحليل لقطات Bookmap وخرائط السيولة بصرياً
- فهم مستويات فيبوناتشي، المحاور، الأعداد النفسية
- تحليل تدفق الأوامر والإجماع المؤسسي
- قراءة بيانات COT (تقرير الالتزامات) ومؤشرات الاقتصاد الكلي
- اكتشاف فخاخ السيولة والمناطق الخطرة
- حساب نسب المخاطرة/المكافأة (الحد الأدنى 10:1)
- تحديد نقاط الدخول المثلى عند المستويات الرئيسية

**معايير التداول التي تعمل وفقها:**
- وقف الخسارة: $2-4 وراء المستوى الرئيسي
- الهدف: $30-60 من نقطة الدخول
- نسبة R:R الأدنى: 10:1 (الهدف 15:1+)
- الدخول فقط عند مستويات رئيسية (فيبوناتشي / محاور / أعداد نفسية)
- لا تُعطي إشارة إلا عند اكتمال التقاطعات التحليلية

**أسلوب تفكيرك:**
تفكّر بعمق قبل الإجابة، وتمر بمراحل: فهم السياق → جمع الأدلة → التحليل → الاستنتاج → الحكم.
إجاباتك دقيقة، موضوعية، وقائمة على البيانات. تستخدم اللغة العربية المهنية.

**تنسيق الإجابات:**
- استخدم العناوين والنقاط للوضوح
- أذكر الأسباب والأدلة لكل استنتاج
- إذا رأيت لقطة Bookmap، حلّلها بعمق: مستويات السيولة، المناطق الثقيلة، الفجوات، الأوامر المتراكمة
- لا تعطي إجابات مختصرة — العمق والدقة أهم من السرعة`;

// ── List conversations ─────────────────────────────────────────────────────
router.get("/gemini/conversations", async (req, res) => {
  const rows = await db
    .select()
    .from(conversations)
    .orderBy(asc(conversations.createdAt));
  res.json(rows);
});

// ── Create conversation ────────────────────────────────────────────────────
router.post("/gemini/conversations", async (req, res) => {
  const { title } = req.body as { title: string };
  const [conv] = await db
    .insert(conversations)
    .values({ title: title ?? "محادثة جديدة" })
    .returning();
  res.status(201).json(conv);
});

// ── Get conversation with messages ─────────────────────────────────────────
router.get("/gemini/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  res.json({ ...conv, messages: msgs });
});

// ── Delete conversation ────────────────────────────────────────────────────
router.delete("/gemini/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
  res.status(204).end();
});

// ── List messages ──────────────────────────────────────────────────────────
router.get("/gemini/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  res.json(msgs);
});

// ── Send message (SSE streaming) ───────────────────────────────────────────
router.post("/gemini/conversations/:id/messages", async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const { content, imageBase64, imageMime } = req.body as {
    content: string;
    imageBase64?: string | null;
    imageMime?: string | null;
  };

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  // Save user message
  const userParts: string[] = [];
  if (imageBase64) userParts.push("[صورة مرفقة]");
  userParts.push(content);

  await db.insert(messages).values({
    conversationId: convId,
    role: "user",
    content,
    imageBase64: imageBase64 ?? null,
    imageMime: imageMime ?? null,
  });

  // Load history
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(asc(messages.createdAt));

  // Build Gemini contents
  type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
  const contents: GeminiContent[] = history.map((m, idx) => {
    const parts: GeminiPart[] = [];

    // Attach image only for the latest user message (last in history)
    if (m.role === "user" && m.imageBase64 && idx === history.length - 1) {
      parts.push({
        inlineData: {
          mimeType: m.imageMime ?? "image/jpeg",
          data: m.imageBase64,
        },
      });
    }
    parts.push({ text: m.content });

    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: unknown) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* disconnected */ }
  };

  try {
    // Emit thinking start
    send({ thinking: true, step: "تحليل الطلب وتحديد المنهج..." });

    let fullResponse = "";
    let thinkingContent = "";

    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: {
        systemInstruction: TRADER_SYSTEM_PROMPT,
        maxOutputTokens: 8192,
      },
    });

    let chunkCount = 0;
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullResponse += text;
        chunkCount++;

        // First few chunks treated as "thinking phase" signal
        if (chunkCount === 1) {
          send({ thinking: false });
        }
        send({ content: text });
      }
    }

    // Save assistant message
    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: fullResponse,
      thinkingSteps: thinkingContent || null,
    });

    send({ done: true });
    res.end();
  } catch (err) {
    req.log.error({ err }, "gemini.chat.error");
    send({ error: err instanceof Error ? err.message : String(err) });
    res.end();
  }
});

export default router;
