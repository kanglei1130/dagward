export interface Runner {
  run(): void;
}

export function runAll(runners: Runner[]): void {
  for (const runner of runners) {
    runner.run();
  }
}
