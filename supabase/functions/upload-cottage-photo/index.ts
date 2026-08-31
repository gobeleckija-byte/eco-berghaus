// Supabase Edge Function: upload-cottage-photo
// Завантаження фото котеджу з адмін-панелі: приймає multipart (file + token),
// перевіряє сесію адміністратора, зберігає у бакет cottage-photos
// і повертає публічний URL.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const formData = await req.formData();
    const token = String(formData.get("token") || "");
    const file = formData.get("file");

    if (!token || !(file instanceof File)) {
      return json({ error: "Не передано токен або файл" }, 400);
    }

    // Перевірка сесії адміністратора
    const { data: session } = await supabaseAdmin
      .from("admin_sessions")
      .select("expires_at")
      .eq("token", token)
      .single();

    if (!session || new Date(session.expires_at) <= new Date()) {
      return json({ error: "Сесію завершено" }, 401);
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return json({ error: "Дозволені лише зображення JPEG, PNG або WebP" }, 400);
    }

    if (file.size > MAX_SIZE) {
      return json({ error: "Файл занадто великий (максимум 5 МБ)" }, 400);
    }

    //Безпечне ім'я файлу: випадкове + розширення за типом
    const ext = file.type === "image/png" ? "png" : (file.type === "image/webp" ? "webp" : "jpg");
    const fileName = `${crypto.randomUUID()}.${ext}`;

    const fileBytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from("cottage-photos")
      .upload(fileName, fileBytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return json({ error: "Помилка завантаження файлу" }, 500);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("cottage-photos")
      .getPublicUrl(fileName);

    return json({ status: "ok", url: urlData.publicUrl });
  } catch (err) {
    console.error("upload-cottage-photo error:", err);
    return json({ error: err.message || "Внутрішня помилка сервера" }, 500);
  }
});
