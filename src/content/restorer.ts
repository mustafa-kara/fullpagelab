export type RestoreAction = () => void | Promise<void>;

export class Restorer {
  private readonly actions: RestoreAction[] = [];
  private restorePromise: Promise<void> | undefined;

  register(action: RestoreAction): void {
    if (this.restorePromise) {
      void Promise.resolve(action());
      return;
    }
    this.actions.push(action);
  }

  restore(): Promise<void> {
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = (async () => {
      let firstError: unknown;
      while (this.actions.length > 0) {
        const action = this.actions.pop();
        if (!action) continue;
        try {
          await action();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    })();
    return this.restorePromise;
  }
}
