// Supabase Edge Function: admin-auth
// Secure Enterprise Authentication Endpoint (2026)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "8845339263:AAEyY_6gw1xQyJjqBOQ2kxp8tECYoWC2oRE";
    const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "2026196111";

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Надійне отримання реального IP з заголовків проксі
    const forwardedHeader = req.headers.get("x-forwarded-for");
    const clientIp = (forwardedHeader ? forwardedHeader.split(",")[0].trim() : null) 
      || req.headers.get("cf-connecting-ip") 
      || "127.0.0.1";

    const body = await req.json();
    const { action } = body;

    // =========================================================================
    // КРОК 1: ІНІЦІАЦІЯ ВХОДУ (Логін + Пароль + Генерація 2FA OTP)
    // =========================================================================
    if (action === "initiate_login") {
      const { email, password } = body;
      if (!email || !password) {
        return new Response(
          JSON.stringify({ error: "Будь ласка, введіть email та пароль" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Генерація криптографічного 6-значного OTP (CSPRNG)
      const otpArray = new Uint32Array(1);
      crypto.getRandomValues(otpArray);
      const otpCode = (100000 + (otpArray[0] % 900000)).toString();

      // Генерація унікальної випадкової солі per-OTP
      const saltArray = new Uint8Array(16);
      crypto.getRandomValues(saltArray);
      const salt = Array.from(saltArray).map((b) => b.toString(16).padStart(2, "0")).join("");

      // Виклик захищеної SQL функції перевірки пароля (bcrypt) та rate limit
      const { data, error } = await supabaseAdmin.rpc("admin_initiate_login", {
        p_email: email,
        p_password: password,
        p_ip: clientIp,
        p_otp_code: otpCode,
        p_salt: salt,
      });

      if (error) {
        console.error("SQL initiate_login error:", error);
        return new Response(
          JSON.stringify({ error: "Помилка сервера автентифікації" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Обробка результату перевірки
      if (data.status === "locked") {
        return new Response(
          JSON.stringify({ 
            status: "locked", 
            message: `Занадто багато спроб входу. Доступ заблоковано на ${Math.ceil(data.retry_after_seconds / 60)} хв.`,
            retry_after_seconds: data.retry_after_seconds 
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (data.status === "invalid_credentials") {
        return new Response(
          JSON.stringify({ 
            status: "invalid_credentials", 
            message: `Невірний email або пароль. Залишилось спроб: ${data.attempts_left}`,
            attempts_left: data.attempts_left 
          }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (data.status === "otp_created") {
        // Відправка 2FA коду в Telegram
        const tgMessage = `🔐 *ВХІД В АДМІН-ПАНЕЛЬ*\n\n` +
          `👤 *Користувач:* ${data.email}\n` +
          `🌐 *IP-адреса:* \`${clientIp}\`\n` +
          `🔑 *Ваш одноразовий код (2FA)*: \`${otpCode}\`\n\n` +
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

        return new Response(
          JSON.stringify({
            status: "otp_sent",
            session_id: data.session_id,
            expires_in_seconds: 180,
            masked_email: email.replace(/(.{2})(.*)(@.*)/, "$1***$3"),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // =========================================================================
    // КРОК 2: АТОМАРНА ВЕРИФІКАЦІЯ 2FA OTP ТА ВИДАЧА ТОКЕНА
    // =========================================================================
    if (action === "verify_otp") {
      const { session_id, otp_code, email } = body;
      if (!session_id || !otp_code) {
        return new Response(
          JSON.stringify({ error: "Введіть 6-значний код підтвердження" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Атомарна верифікація в БД (декремент + перевірка хешу)
      const { data, error } = await supabaseAdmin.rpc("admin_verify_otp", {
        p_session_id: session_id,
        p_otp_code: otp_code.trim(),
      });

      if (error) {
        console.error("SQL verify_otp error:", error);
        return new Response(
          JSON.stringify({ error: "Помилка перевірки коду" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (data.status === "session_expired_or_exhausted") {
        return new Response(
          JSON.stringify({ status: "expired", message: data.message }),
          { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (data.status === "invalid_otp") {
        return new Response(
          JSON.stringify({ 
            status: "invalid_otp", 
            message: `Невірний код 2FA. Залишилось спроб: ${data.attempts_left}`,
            attempts_left: data.attempts_left 
          }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (data.status === "success") {
        // Отримуємо або створюємо GoTrue сесію
        // Використовуємо generateLink для створення токена сесії без потреби переходу за посиланням
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: email || "admin@ecoberghaus.com.ua",
        });

        const hashedToken = linkData?.properties?.hashed_token;

        return new Response(
          JSON.stringify({
            status: "authenticated",
            user_id: data.user_id,
            email: email || "admin@ecoberghaus.com.ua",
            token_hash: hashedToken,
            action_link: linkData?.properties?.action_link,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Невідома дія" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Внутрішня помилка сервера" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
