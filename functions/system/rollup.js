import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function monthKeyFromMs(ms) {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function gerarRollupMensalFinancas() {
  const db = getDatabase();
  const eventsSnap = await db.ref('financas/eventos').get();
  const rawEvents = eventsSnap.exists() ? Object.values(eventsSnap.val() || {}) : [];
  const monthly = new Map();
  for (const event of rawEvents) {
    const tipo = String(event?.tipo || '');
    if (tipo !== 'premium_aprovado' && tipo !== 'apoio_aprovado') continue;
    const at = toNum(event?.at, 0);
    if (!at) continue;
    const month = monthKeyFromMs(at);
    if (!monthly.has(month)) {
      monthly.set(month, {
        totalAmount: 0,
        premiumAmount: 0,
        apoioAmount: 0,
        premiumCount: 0,
        apoioCount: 0,
      });
    }
    const row = monthly.get(month);
    const amount = toNum(event?.amount, 0);
    row.totalAmount += amount;
    if (tipo === 'premium_aprovado') {
      row.premiumAmount += amount;
      row.premiumCount += 1;
    } else {
      row.apoioAmount += amount;
      row.apoioCount += 1;
    }
  }

  const updates = {};
  for (const [month, row] of monthly.entries()) {
    updates[`financas/aggregates/monthly/${month}`] = {
      ...row,
      totalAmount: Math.round(row.totalAmount * 100) / 100,
      premiumAmount: Math.round(row.premiumAmount * 100) / 100,
      apoioAmount: Math.round(row.apoioAmount * 100) / 100,
      updatedAt: Date.now(),
    };
  }
  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }
  return Object.keys(updates).length;
}

export const dashboardRollupMensal = onSchedule(
  {
    schedule: '15 3 * * *',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const months = await gerarRollupMensalFinancas();
    logger.info('dashboardRollupMensal ok', { months });
  }
);
