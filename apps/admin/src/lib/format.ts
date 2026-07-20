/**
 * Display formatting. The API already returns human strings for money (`balanceRupees`), so this
 * is mostly dates and a paise fallback — never money arithmetic, which stays server-side in
 * integer paise.
 */

/** Formats a paise string/number as rupees for display only. */
export function paiseToRupees(paise: string | number): string {
  const n = typeof paise === 'string' ? Number(paise) : paise;
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}₹${Math.floor(abs / 100).toLocaleString('en-IN')}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}
