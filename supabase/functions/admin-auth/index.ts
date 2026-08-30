// Supabase Edge Function: admin-auth
// Серверний обробник входу адміністратора:
//  - OTP генерується тут (не в браузері) і надсилається в Telegram з env-секретів
//  - після verify_otp клієнт отримує серверний токен сесії (admin_sessions)

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "";

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Реальний IP клієнта з заголовків проксі (для rate limiter в БД)
    const forwarded = req.headers.get("x-forwarded-for");
    const clientIp = (forwarded ? forwarded.split(",")[0].trim() : null)
      || req.headers.get("cf-connecting-ip")
      || "unknown";

    const body = await req.json();
    const { action } = body;

    // =====================================================================
    // КРОК 1: ЛОГІН + ПАРОЛЬ -> ГЕНЕРАЦІЯ 2FA OTP НА СЕРВЕРІ
    // =====================================================================
    if (action === "initiate_login") {
      const { username, password } = body;
      if (!username || !password) {
        return json({ error: "Введіть логін та пароль" }, 400);
      }

      // CSPRNG OTP + унікальна сіль — тільки на сервері
      const otpArray = new Uint32Array(1);
      crypto.getRandomValues(otpArray);
      const otpCode = (100000 + (otpArray[0] % 900000)).toString();

      const saltArray = new Uint8Array(16);
      crypto.getRandomValues(saltArray);
      const salt = Array.from(saltArray).map((b) => b.toString(16).padStart(2, "0")).join("");

      const { data, error } = await supabaseAdmin.rpc("admin_initiate_login", {
        p_username: username,
        p_password: password,
        p_ip: clientIp,
        p_otp_code: otpCode,
        p_salt: salt,
      });

      if (error) {
        console.error("SQL initiate_login error:", error);
        return json({ error: "Помилка сервера автентифікації" }, 500);
      }

      if (data.status === "locked") {
        return json({
          status: "locked",
          retry_after_seconds: data.retry_after_seconds,
        }, 429);
      }

      if (data.status === "invalid_credentials") {
        return json({
          status: "invalid_credentials",
          attempts_left: data.attempts_left,
        }, 401);
      }

      if (data.status === "otp_created") {
        // Код 2FA надсилаємо в Telegram ТІЛЬКИ звідси
        const tgMessage =
          `🔐 *ВХІД В АДМІН-ПАНЕЛЬ*\n\n` +
          `👤 *Користувач:* ${data.username || username}\n` +
          `🌐 *IP:* \`${clientIp}\`\n` +
          `🔑 *Одноразовий код (2FA)*: \`${otpCode}\`\n\n` +
          `⏳ Код дійсний 3 хвилини. Не передавайте його нікому!`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text: tgMessage,
              parse_mode: "Markdown",
            }),
          });
        } catch (tgErr) {
          console.error("Telegram send error:", tgErr);
        }

        return json({
          status: "otp_sent",
          session_id: data.session_id,
          username: data.username || username,
          expires_in_seconds: 180,
        });
      }

      return json({ error: "Невідома відповідь сервера" }, 500);
    }

    // =====================================================================
    // КРОК 2: ВЕРИФІКАЦІЯ OTP -> СЕРВЕРНИЙ ТОКЕН СЕСІЇ
    // =====================================================================
    if (action === "verify_otp") {
      const { session_id, otp_code } = body;
      if (!session_id || !otp_code) {
        return json({ error: "Введіть 6-значний код підтвердження" }, 400);
      }

      const { data, error } = await supabaseAdmin.rpc("admin_verify_otp", {
        p_session_id: session_id,
        p_otp_code: String(otp_code).trim(),
      });

      if (error) {
        console.error("SQL verify_otp error:", error);
        return json({ error: "Помилка перевірки коду" }, 500);
      }

      if (data.status === "session_expired_or_exhausted") {
        return json({ status: "expired", message: data.message }, 410);
      }

      if (data.status === "invalid_otp") {
        return json({ status: "invalid_otp", attempts_left: data.attempts_left }, 401);
      }

      if (data.status === "success") {
        return json({
          status: "authenticated",
          user_id: data.user_id,
          session_token: data.session_token,
        });
      }

      return json({ error: "Невідома відповідь сервера" }, 500);
    }

    return json({ error: "Невідома дія" }, 400);
  } catch (err) {
    return json({ error: err.message || "Внутрішня помилка сервера" }, 500);
  }
});
