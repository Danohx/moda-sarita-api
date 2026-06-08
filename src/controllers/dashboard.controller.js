import { getDashboardData } from "../models/dashboard.model.js";

const VALID_RANGES = new Set(["today", "7d", "30d", "month", "custom"]);

function toSafeLimit(value, fallback, max) {
  const n = Number(value);

  if (!Number.isInteger(n)) return fallback;
  if (n <= 0) return fallback;
  if (n > max) return max;

  return n;
}

function isValidDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateToYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseYmd(value) {
  if (!isValidDateString(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function resolveDateRange(query = {}) {
  const requestedRange = String(query.range || "7d");
  const range = VALID_RANGES.has(requestedRange) ? requestedRange : "7d";

  const today = startOfDay(new Date());

  if (range === "today") {
    return {
      range,
      fromDate: dateToYmd(today),
      toDate: dateToYmd(addDays(today, 1)),
    };
  }

  if (range === "7d") {
    return {
      range,
      fromDate: dateToYmd(addDays(today, -6)),
      toDate: dateToYmd(addDays(today, 1)),
    };
  }

  if (range === "30d") {
    return {
      range,
      fromDate: dateToYmd(addDays(today, -29)),
      toDate: dateToYmd(addDays(today, 1)),
    };
  }

  if (range === "month") {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    return {
      range,
      fromDate: dateToYmd(firstDay),
      toDate: dateToYmd(nextMonth),
    };
  }

  const from = parseYmd(query.from);
  const to = parseYmd(query.to);

  if (!from || !to || from > to) {
    return {
      range: "7d",
      fromDate: dateToYmd(addDays(today, -6)),
      toDate: dateToYmd(addDays(today, 1)),
    };
  }

  return {
    range,
    fromDate: dateToYmd(from),
    toDate: dateToYmd(addDays(to, 1)),
  };
}

export async function getDashboard(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        msg: "DB context no configurado (req.db)",
      });
    }

    const { range, fromDate, toDate } = resolveDateRange(req.query);

    const topLimit = toSafeLimit(req.query.topLimit, 5, 20);
    const actividadLimit = toSafeLimit(req.query.actividadLimit, 5, 30);
    const alertasLimit = toSafeLimit(req.query.alertasLimit, 3, 30);
    const productosCriticosLimit = toSafeLimit(
      req.query.productosCriticosLimit,
      8,
      30,
    );

    const data = await getDashboardData(req.db, {
      range,
      fromDate,
      toDate,
      topLimit,
      actividadLimit,
      alertasLimit,
      productosCriticosLimit,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    console.error("getDashboard error:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error cargando dashboard",
      detail: err.message,
    });
  }
}