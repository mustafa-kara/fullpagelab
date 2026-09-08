import { describe, expect, it, vi } from 'vitest';
import { CommandStack } from '../../src/lib/editor/command-stack';

function counterCommand(log: string[], label: string) {
  return { label, do: () => log.push(`do:${label}`), undo: () => log.push(`undo:${label}`) };
}

describe('command stack', () => {
  it('runs a command when it is pushed', () => {
    const log: string[] = [];
    new CommandStack().push(counterCommand(log, 'a'));
    expect(log).toEqual(['do:a']);
  });

  it('undoes and redoes in order', () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(counterCommand(log, 'a'));
    stack.push(counterCommand(log, 'b'));
    stack.undo();
    stack.undo();
    stack.redo();
    expect(log).toEqual(['do:a', 'do:b', 'undo:b', 'undo:a', 'do:a']);
  });

  it('reports what is available', () => {
    const stack = new CommandStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    stack.push(counterCommand([], 'a'));
    expect(stack.canUndo).toBe(true);
    stack.undo();
    expect(stack.canRedo).toBe(true);
  });

  it('ignores undo and redo when the stack is empty', () => {
    const stack = new CommandStack();
    expect(() => { stack.undo(); stack.redo(); }).not.toThrow();
  });

  it('drops the redo branch once a new command is pushed', () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(counterCommand(log, 'a'));
    stack.undo();
    stack.push(counterCommand(log, 'b'));
    stack.redo();
    expect(log).toEqual(['do:a', 'undo:a', 'do:b']);
    expect(stack.canRedo).toBe(false);
  });

  it('merges a command into the previous one when merge returns true', () => {
    const stack = new CommandStack();
    const merge = vi.fn(() => true);
    stack.push({ label: 'drag', do: () => undefined, undo: () => undefined, merge });
    stack.push({ label: 'drag', do: () => undefined, undo: () => undefined });
    expect(merge).toHaveBeenCalledTimes(1);
    expect(stack.depth).toBe(1);
  });

  it('keeps commands separate when merge declines', () => {
    const stack = new CommandStack();
    stack.push({ label: 'a', do: () => undefined, undo: () => undefined, merge: () => false });
    stack.push({ label: 'b', do: () => undefined, undo: () => undefined });
    expect(stack.depth).toBe(2);
  });

  it('caps the stack at its maximum depth', () => {
    const stack = new CommandStack(3);
    for (const label of ['a', 'b', 'c', 'd']) stack.push(counterCommand([], label));
    expect(stack.depth).toBe(3);
  });

  it('clears both stacks', () => {
    const stack = new CommandStack();
    stack.push(counterCommand([], 'a'));
    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.depth).toBe(0);
  });

  it('exposes the label of the next undo step', () => {
    const stack = new CommandStack();
    stack.push(counterCommand([], 'Add arrow'));
    expect(stack.undoLabel).toBe('Add arrow');
    stack.undo();
    expect(stack.undoLabel).toBeUndefined();
    expect(stack.redoLabel).toBe('Add arrow');
  });
});
