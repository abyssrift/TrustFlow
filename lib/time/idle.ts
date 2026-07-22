export const idleLabel = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `Idle ${m}m` : `Idle ${Math.floor(m / 60)}h ${m % 60}m`;
};
