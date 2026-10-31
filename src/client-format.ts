/** Use the host's active translation dictionary, including when <html lang> is unset. */
export function formatTimestamp(timestamp: number, t: (key: 'dateLocale') => string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(t('dateLocale')) : '—';
}
