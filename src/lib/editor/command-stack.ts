export interface Command {
  label: string;
  do(): void;
  undo(): void;
  /** Return true to absorb `next` into this command instead of stacking it. */
  merge?(next: Command): boolean;
}

export class CommandStack {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  constructor(private readonly max = 200) {}

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get depth(): number { return this.undoStack.length; }
  get undoLabel(): string | undefined { return this.undoStack.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.redoStack.at(-1)?.label; }

  push(command: Command): void {
    command.do();
    this.redoStack.length = 0;
    const previous = this.undoStack.at(-1);
    if (previous?.merge?.(command)) return;
    this.undoStack.push(command);
    if (this.undoStack.length > this.max) this.undoStack.shift();
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;
    command.do();
    this.undoStack.push(command);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
