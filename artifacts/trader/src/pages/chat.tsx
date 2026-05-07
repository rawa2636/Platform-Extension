import { useState, useRef, useEffect, useCallback } from "react";
import { useListGeminiConversations, useCreateGeminiConversation, useDeleteGeminiConversation, useGetGeminiConversation, getListGeminiConversationsQueryKey, getGetGeminiConversationQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Plus, Trash2, Send, Paperclip, X, Brain, Loader2, ChevronLeft, Bot, User, Image } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type StreamMsg = { role: "user" | "assistant"; content: string; imageBase64?: string; imageMime?: string; id?: number; thinking?: boolean };

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-muted px-1 rounded text-xs font-mono">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold mt-3 mb-1 text-primary">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold mt-4 mb-1 text-primary">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-4 mb-2 text-primary">$1</h1>')
    .replace(/^- (.+)$/gm, '<li class="mr-4 list-disc text-sm">$1</li>')
    .replace(/(<li.*<\/li>)/gs, '<ul class="my-2 space-y-0.5">$1</ul>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

export default function Chat() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: conversations = [], isLoading: convsLoading } = useListGeminiConversations({
    query: { queryKey: getListGeminiConversationsQueryKey() }
  });

  const createConv = useCreateGeminiConversation();
  const deleteConv = useDeleteGeminiConversation();

  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<StreamMsg[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ base64: string; mime: string; preview: string } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: convData } = useGetGeminiConversation(
    activeConvId ?? 0,
    { query: { enabled: !!activeConvId, queryKey: getGetGeminiConversationQueryKey(activeConvId ?? 0) } }
  );

  useEffect(() => {
    if (convData) {
      setMessages(
        (convData.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          imageBase64: m.imageBase64 ?? undefined,
          imageMime: m.imageMime ?? undefined,
        }))
      );
    }
  }, [convData]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  async function handleNewConv() {
    const res = await createConv.mutateAsync({ data: { title: "محادثة جديدة" } });
    queryClient.invalidateQueries({ queryKey: getListGeminiConversationsQueryKey() });
    setActiveConvId(res.id);
    setMessages([]);
  }

  async function handleDeleteConv(id: number) {
    await deleteConv.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListGeminiConversationsQueryKey() });
    if (activeConvId === id) { setActiveConvId(null); setMessages([]); }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast({ variant: "destructive", title: "الحجم كبير", description: "الحد الأقصى 4 ميغابايت" }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setImage({ base64, mime: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && !image) || streaming) return;
    if (!activeConvId) { toast({ variant: "destructive", title: "اختر محادثة أولاً" }); return; }

    const userMsg: StreamMsg = {
      role: "user",
      content: input.trim(),
      imageBase64: image?.base64,
      imageMime: image?.mime,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setImage(null);
    setStreaming(true);
    setThinking(true);

    // Placeholder for streaming assistant reply
    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: "assistant", content: "", thinking: true }]);

    try {
      const resp = await fetch(`/api/gemini/conversations/${activeConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: userMsg.content || " ",
          imageBase64: userMsg.imageBase64 ?? null,
          imageMime: userMsg.imageMime ?? null,
        }),
      });

      if (!resp.body) throw new Error("لا يوجد body في الاستجابة");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as { content?: string; thinking?: boolean; done?: boolean; error?: string };
            if (chunk.thinking === true) {
              setThinking(true);
            } else if (chunk.thinking === false) {
              setThinking(false);
            } else if (chunk.content) {
              fullContent += chunk.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: fullContent, thinking: false };
                return updated;
              });
            } else if (chunk.done) {
              setThinking(false);
            } else if (chunk.error) {
              throw new Error(chunk.error);
            }
          } catch { /* ignore parse errors */ }
        }
      }

      queryClient.invalidateQueries({ queryKey: getListGeminiConversationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGeminiConversationQueryKey(activeConvId) });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: `خطأ: ${err instanceof Error ? err.message : String(err)}` };
        return updated;
      });
    } finally {
      setStreaming(false);
      setThinking(false);
    }

    void assistantIdx;
  }, [input, image, streaming, activeConvId, messages.length, queryClient, toast]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-full gap-0 -m-6 overflow-hidden">

      {/* ── Sidebar: conversation list ─────────────────────────────── */}
      <div className="w-64 border-l border-border bg-card flex flex-col shrink-0">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">المحادثات</span>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleNewConv} disabled={createConv.isPending}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {convsLoading && <Skeleton className="h-8 w-full" />}
          {conversations.length === 0 && !convsLoading && (
            <p className="text-xs text-muted-foreground text-center py-4">لا توجد محادثات بعد</p>
          )}
          <AnimatePresence>
            {[...conversations].reverse().map((conv) => (
              <motion.div
                key={conv.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm ${
                  activeConvId === conv.id ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                }`}
                onClick={() => { setActiveConvId(conv.id); }}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{conv.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); handleDeleteConv(conv.id); }}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Agent capabilities reminder */}
        <div className="p-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            يمكنك إرسال لقطات Bookmap أو طرح أسئلة عن السوق والوكلاء والإشارات
          </p>
        </div>
      </div>

      {/* ── Main chat area ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {!activeConvId ? (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm">
              <Brain className="w-16 h-16 mx-auto mb-4 text-primary opacity-30" />
              <h2 className="text-lg font-semibold mb-2">مساعد التحليل المتقدم</h2>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                اطرح سؤالاً عن السوق، أو أرفق لقطة Bookmap للتحليل البصري، أو اطلب تشغيل وكلاء التحليل بالكامل
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-6">
                {[
                  "تحليل مستويات السيولة",
                  "قراءة خريطة Bookmap",
                  "نقاط دخول فيبوناتشي",
                  "تحليل بيانات COT",
                  "كشف فخاخ السوق",
                  "نسبة R:R المثلى",
                ].map(cap => (
                  <div key={cap} className="flex items-center gap-1.5 bg-muted/50 rounded px-2 py-1.5">
                    <div className="w-1 h-1 rounded-full bg-primary opacity-60" />
                    {cap}
                  </div>
                ))}
              </div>
              <Button onClick={handleNewConv} disabled={createConv.isPending} className="gap-2">
                <Plus className="w-4 h-4" />
                بدء محادثة جديدة
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">ابدأ المحادثة بسؤال أو بإرفاق صورة Bookmap</p>
                </div>
              )}

              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted border border-border"
                    }`}>
                      {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
                    </div>

                    {/* Bubble */}
                    <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-card border border-border rounded-tl-sm"
                    }`}>
                      {/* Image preview */}
                      {msg.imageBase64 && msg.role === "user" && (
                        <div className="mb-2">
                          <img
                            src={`data:${msg.imageMime ?? "image/jpeg"};base64,${msg.imageBase64}`}
                            alt="صورة مرفقة"
                            className="max-h-48 rounded-lg border border-white/20 object-contain"
                          />
                        </div>
                      )}

                      {/* Thinking indicator */}
                      {msg.thinking && msg.content === "" ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span className="text-xs">جارٍ التحليل العميق...</span>
                        </div>
                      ) : msg.role === "assistant" ? (
                        <div
                          className="prose-invert text-foreground text-sm"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(msg.content) }}
                        />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Thinking phase indicator */}
              {thinking && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="bg-card border border-primary/30 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">التفكير العميق جارٍ...</span>
                  </div>
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Image preview bar */}
            {image && (
              <div className="px-4 pb-2">
                <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2">
                  <Image className="w-4 h-4 text-primary shrink-0" />
                  <img src={image.preview} alt="" className="h-10 rounded object-contain" />
                  <span className="text-xs text-muted-foreground flex-1">صورة مرفقة (Bookmap)</span>
                  <button onClick={() => setImage(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Input area */}
            <div className="p-4 border-t border-border bg-card">
              <div className="flex gap-2 items-end">
                {/* Attach image */}
                <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 text-muted-foreground hover:text-primary"
                  onClick={() => fileRef.current?.click()}
                  title="إرفاق صورة Bookmap"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>

                {/* Textarea */}
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="اكتب سؤالك أو اطلب تحليلاً... (Enter للإرسال، Shift+Enter لسطر جديد)"
                  className="flex-1 min-h-[44px] max-h-32 resize-none text-sm"
                  rows={1}
                  disabled={streaming}
                  dir="rtl"
                />

                {/* Send */}
                <Button
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={sendMessage}
                  disabled={(!input.trim() && !image) || streaming}
                >
                  {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                يعمل بـ Gemini Flash · تحليل عميق متعدد المراحل · يدعم صور Bookmap
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
