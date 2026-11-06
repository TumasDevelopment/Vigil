// Quando un host che risponde va segnalato come instabile. Niente dipendenze: la usano query e test.

export interface HealthInput {
  failStreak: number;
  lastLoss: number | null;
  /** Medie dell'ultimo minuto */
  rtt1m: number | null;
  loss1m: number | null;
  /** Soglie già risolte tra host e tipo: null significa nessuna soglia */
  latencyWarn: number | null;
  lossWarn: number | null;
  failedServices: string[];
}

const num = (value: number) => value.toLocaleString("it-IT", { maximumFractionDigits: 1 });

/** Con la perdita senza soglia conta ogni pacchetto perso nell'ultimo ciclo. */
export function healthProblems(input: HealthInput): string[] {
  const problems: string[] = [];

  if (input.failStreak > 0) {
    problems.push("Ultimo controllo fallito");
  } else if (input.lossWarn === null && (input.lastLoss ?? 0) > 0) {
    problems.push(`Perdita ${num(input.lastLoss ?? 0)} %`);
  }

  if (input.lossWarn !== null && (input.loss1m ?? 0) > input.lossWarn) {
    problems.push(`Perdita ${num(input.loss1m ?? 0)} %, soglia ${num(input.lossWarn)} %`);
  }
  if (input.latencyWarn !== null && input.rtt1m !== null && input.rtt1m > input.latencyWarn) {
    problems.push(`Latenza ${num(input.rtt1m)} ms, soglia ${num(input.latencyWarn)} ms`);
  }

  const failed = input.failedServices;
  if (failed.length === 1) problems.push(`${failed[0]} non risponde`);
  else if (failed.length > 1) problems.push(`${failed.length} servizi non rispondono`);

  return problems;
}
