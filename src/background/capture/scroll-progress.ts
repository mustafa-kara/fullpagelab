import type { ScrollPlan, ScrollStep } from '../../shared/types/capture';
import type { Point } from '../../shared/types/primitives';
import { CaptureValidationError } from './validation';

const tolerance = 1;

export function assertAcknowledgedProgress(
  plan: ScrollPlan,
  step: ScrollStep,
  actual: Point,
  previous?: { step: ScrollStep; actual: Point },
): void {
  if (step.index === 0) {
    const start = plan.steps[0]?.scrollTo ?? { x: 0, y: 0 };
    if (Math.abs(actual.x - start.x) > tolerance || Math.abs(actual.y - start.y) > tolerance) {
      throw new CaptureValidationError(
        'E_VALIDATION',
        'The page did not reach the capture origin; capture stopped to avoid a cropped first section.',
        true,
      );
    }
    return;
  }
  if (!previous) {
    throw new CaptureValidationError('E_VALIDATION', 'The previous scroll acknowledgement is missing.', true);
  }
  const movedToNewRow = step.row > previous.step.row;
  const progressed = movedToNewRow
    ? actual.y > previous.actual.y + tolerance
    : actual.x > previous.actual.x + tolerance;
  if (!progressed) {
    throw new CaptureValidationError(
      'E_VALIDATION',
      'The page stopped scrolling before capture completed; duplicate tiles were prevented.',
      true,
    );
  }
}
