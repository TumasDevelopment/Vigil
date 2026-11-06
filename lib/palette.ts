// Ordine verificato con il validatore: è l'ordine a garantire che le linee
// vicine restino distinguibili anche con daltonismo, quindi non va cambiato.
// Verde e rosso pieni sono esclusi perché riservati a online/offline.
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#a77be0", "#c98500", "#d6569b"];
export const MAX_SERIES = SERIES_COLORS.length;

export const STATE_COLORS = {
  online: "#22ad3f",
  partial: "#ffb020",
  offline: "#e5484d",
  unreachable: "#e07b39",
  maintenance: "#4d83c4",
  nodata: "#3a414d",
};

export const CHART_COLORS = {
  surface: "#171b23",
  axis: "#8b94a3",
  grid: "#252b36",
  baseline: "#333a47",
};

export function withAlpha(hex: string, alpha: number) {
  const value = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${value}`;
}
