export class Greeter {
  constructor(private readonly punctuation: string) {}

  greet(): string {
    return this.prefix() + "hi" + this.punctuation;
  }

  prefix(): string {
    return "> ";
  }
}

export function makeGreeter(): Greeter {
  return new Greeter("!");
}
