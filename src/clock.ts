export class FixedClock {
  private accumulator = 0;
  reset() {
    this.accumulator = 0;
  }
  advance(elapsed: number, speed: number, active: boolean, step: () => void) {
    if (!active) {
      this.reset();
      return 0;
    }
    this.accumulator +=
      Math.max(0, Math.min(0.05, elapsed)) * Math.max(0.5, Math.min(4, speed));
    let count = 0;
    while (this.accumulator + 1e-10 >= 1 / 60 && count < 18) {
      step();
      this.accumulator -= 1 / 60;
      count++;
    }
    return count;
  }
}
