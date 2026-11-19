import { Workbook } from 'exceljs';
import { PlayerRatingAuditRow } from './player-ratings.types';

const columns: [keyof PlayerRatingAuditRow, string][] = [
  ['id', 'ID записи'], ['occurredAt', 'Дата и время (UTC)'], ['eventType', 'Действие'],
  ['actorId', 'ID сотрудника'], ['actorName', 'Сотрудник'], ['stationId', 'Станция'], ['playerKey', 'ID игрока'],
  ['playerName', 'Игрок'], ['before', 'Уровень до'], ['gradeBefore', 'Буква до'],
  ['after', 'Уровень после'], ['gradeAfter', 'Буква после'], ['reason', 'Комментарий']
];

function csvCell(value: string | number | null): string {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@\t\r\n]/u.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export async function exportPlayerRatingAudit(rows: PlayerRatingAuditRow[], format: 'csv' | 'xlsx'): Promise<Buffer> {
  const headers = columns.map(([, title]) => title);
  const values = rows.map(row => columns.map(([key]) => row[key]));
  if (format === 'csv') {
    return Buffer.from('\uFEFF' + [headers, ...values].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
  }
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Изменения уровней', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([key]) => ({ width: key === 'reason' ? 50 : 25 }));
  sheet.addRow(headers).font = { bold: true };
  sheet.addRows(values);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
