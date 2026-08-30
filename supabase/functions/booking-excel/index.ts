// Supabase Edge Function: booking-excel
// Генерує брендований xlsx-документ бронювання (як у старому бронюванні)
// і надсилає його документом у Telegram. Викликається після create_booking.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

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

function buildBookingExcel(booking: Record<string, unknown>, cottageName: string | null): Uint8Array {
  const COLOR = {
    accent: "FF4A7C59",
    accentDark: "FF2D5A3D",
    bg: "FFF4F7F2",
    rowAlt: "FFEAF0E6",
    white: "FFFFFFFF",
    black: "FF1C2B1E",
    muted: "FF7A8C7D",
    border: "FFC5D4C0",
    headerBg: "FF2D5A3D",
    statusBg: "FFE8F4EC",
    statusText: "FF1E7A3E",
    footerBg: "FFEEF3EC",
  };

  const FONT_TITLE  = { name: "Arial", sz: 18, bold: true, color: { rgb: COLOR.accentDark } };
  const FONT_SUB    = { name: "Arial", sz: 10, italic: true, color: { rgb: COLOR.muted } };
  const FONT_HEADER = { name: "Arial", sz: 11, bold: true, color: { rgb: COLOR.white } };
  const FONT_LABEL  = { name: "Arial", sz: 11, bold: true, color: { rgb: COLOR.accentDark } };
  const FONT_VALUE  = { name: "Arial", sz: 11, color: { rgb: COLOR.black } };
  const FONT_STATUS = { name: "Arial", sz: 11, bold: true, color: { rgb: COLOR.statusText } };
  const FONT_FOOTER = { name: "Arial", sz: 9, italic: true, color: { rgb: COLOR.muted } };

  const ALIGN_CENTER = { horizontal: "center", vertical: "center" };
  const ALIGN_LEFT = { horizontal: "left", vertical: "center", indent: 1 };

  const borderThin = (color = COLOR.border) => ({
    top: { style: "thin", color: { rgb: color } },
    bottom: { style: "thin", color: { rgb: color } },
    left: { style: "thin", color: { rgb: color } },
    right: { style: "thin", color: { rgb: color } },
  });
  const borderBottom = (color = COLOR.accent) => ({
    bottom: { style: "medium", color: { rgb: color } },
  });

  const cell = (v: unknown, s: unknown) => ({ v, t: typeof v === "number" ? "n" : "s", s });

  const checkIn = new Date(String(booking.check_in));
  const checkOut = new Date(String(booking.check_out));
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  const adults = Number(booking.adults_count) || 0;
  const children = Number(booking.children_count) || 0;
  const totalGuests = adults + children;

  const nightLabel = (n: number) => {
    if (n === 1) return `${n} ніч`;
    if (n < 5) return `${n} ночі`;
    return `${n} ночей`;
  };

  const fmt = (d: Date) =>
    d instanceof Date && !isNaN(d.getTime())
      ? d.toLocaleDateString("uk-UA", { day: "2-digit", month: "long", year: "numeric" })
      : "—";

  const ws: Record<string, unknown> = {};

  ws["A1"] = cell("🏔  EcoBerghaus — Підтвердження бронювання", {
    font: FONT_TITLE,
    alignment: ALIGN_CENTER,
    fill: { fgColor: { rgb: COLOR.bg }, patternType: "solid" },
    border: borderBottom(COLOR.accent),
  });

  ws["A2"] = cell(`Сформовано: ${new Date().toLocaleString("uk-UA")}`, {
    font: FONT_SUB,
    alignment: ALIGN_CENTER,
    fill: { fgColor: { rgb: COLOR.bg }, patternType: "solid" },
  });

  ws["A3"] = cell("", { fill: { fgColor: { rgb: COLOR.white }, patternType: "solid" } });

  const headerStyle = {
    font: FONT_HEADER,
    fill: { fgColor: { rgb: COLOR.headerBg }, patternType: "solid" },
    alignment: ALIGN_CENTER,
    border: borderThin(COLOR.headerBg),
  };
  ws["A5"] = cell("Параметр", headerStyle);
  ws["B5"] = cell("Значення", headerStyle);

  const rows: Array<[string, string | number]> = [
    ["👤  Ім'я гостя", String(booking.guest_name ?? "—")],
    ["📞  Телефон", String(booking.guest_phone ?? "—")],
    ["🏠  Котедж", cottageName ?? "—"],
    ["📅  Дата заїзду", fmt(checkIn)],
    ["📅  Дата виїзду", fmt(checkOut)],
    ["🌙  Кількість ночей", nights > 0 ? nightLabel(nights) : "—"],
    ["🧑  Дорослих", adults],
    ["👶  Дітей", children],
    ["👥  Гостей загалом", totalGuests],
  ];

  rows.forEach(([label, value], i) => {
    const rowNum = i + 6;
    const bgColor = i % 2 === 1 ? COLOR.rowAlt : COLOR.white;
    ws[`A${rowNum}`] = cell(label, {
      font: FONT_LABEL,
      fill: { fgColor: { rgb: bgColor }, patternType: "solid" },
      alignment: ALIGN_LEFT,
      border: borderThin(),
    });
    ws[`B${rowNum}`] = {
      v: value,
      t: typeof value === "number" ? "n" : "s",
      s: {
        font: FONT_VALUE,
        fill: { fgColor: { rgb: bgColor }, patternType: "solid" },
        alignment: ALIGN_LEFT,
        border: borderThin(),
      },
    };
  });

  const statusRow = rows.length + 6;

  ws[`A${statusRow}`] = cell("", {});
  ws[`B${statusRow}`] = cell("", {});

  ws[`A${statusRow + 1}`] = cell("🔖  Статус", {
    font: FONT_LABEL,
    fill: { fgColor: { rgb: COLOR.statusBg }, patternType: "solid" },
    alignment: ALIGN_LEFT,
    border: borderThin("FF7FB08A"),
  });
  ws[`B${statusRow + 1}`] = cell("⏳ Очікує підтвердження", {
    font: FONT_STATUS,
    fill: { fgColor: { rgb: COLOR.statusBg }, patternType: "solid" },
    alignment: ALIGN_LEFT,
    border: borderThin("FF7FB08A"),
  });

  ws[`A${statusRow + 2}`] = cell("", {});
  ws[`B${statusRow + 2}`] = cell("", {});

  ws[`A${statusRow + 3}`] = cell("© EcoBerghaus  •  Документ згенеровано автоматично", {
    font: FONT_FOOTER,
    alignment: ALIGN_CENTER,
    fill: { fgColor: { rgb: COLOR.footerBg }, patternType: "solid" },
    border: { top: { style: "thin", color: { rgb: COLOR.border } } },
  });
  ws[`B${statusRow + 3}`] = cell("", {
    fill: { fgColor: { rgb: COLOR.footerBg }, patternType: "solid" },
    border: { top: { style: "thin", color: { rgb: COLOR.border } } },
  });

  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
  ];
  for (let r = statusRow - 1; r <= statusRow + 3; r++) {
    merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
  }
  ws["!merges"] = merges;

  ws["!cols"] = [{ wch: 28 }, { wch: 36 }];
  ws["!rows"] = [
    { hpt: 38 },
    { hpt: 18 },
    { hpt: 8 },
    {},
    { hpt: 24 },
    ...Array(rows.length).fill({ hpt: 22 }),
    { hpt: 8 },
    { hpt: 24 },
    { hpt: 8 },
    { hpt: 20 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Бронювання");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Uint8Array;
  return out;
}

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

    const { booking_id } = await req.json();
    if (!booking_id) {
      return json({ error: "Не передано booking_id" }, 400);
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return json({ error: "Бронювання не знайдено" }, 404);
    }

    let cottageName: string | null = null;
    if (booking.cottage_id) {
      const { data: cottage } = await supabaseAdmin
        .from("cottages")
        .select("name")
        .eq("id", booking.cottage_id)
        .single();
      cottageName = cottage?.name ?? null;
    }

    const xlsxBytes = buildBookingExcel(booking, cottageName);

    const guestSafe = String(booking.guest_name || "guest").replace(/[^\p{L}\p{N}_-]+/gu, "_");
    const fileName = `ecoberghaus_booking_${guestSafe}_${Date.now()}.xlsx`;

    const formData = new FormData();
    formData.append("chat_id", TELEGRAM_CHAT_ID);
    formData.append("caption", `📄 Документ бронювання: ${booking.guest_name} (${cottageName ?? "котедж не вказано"})`);
    formData.append("document", new Blob([xlsxBytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), fileName);

    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: formData,
    });

    if (!tgRes.ok) {
      console.error("Telegram sendDocument failed:", await tgRes.text());
      return json({ status: "telegram_error" }, 502);
    }

    return json({ status: "ok" });
  } catch (err) {
    console.error("booking-excel error:", err);
    return json({ error: err.message || "Внутрішня помилка сервера" }, 500);
  }
});
