import type { Annotation } from '../shared/types/editor';

export interface FabricOptions {
  ssxId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  fill: string;
  selectable: boolean;
  evented: boolean;
  visible: boolean;
}

/** Translates an Annotation into the option bag a Fabric object constructor accepts. */
export function toFabricOptions(annotation: Annotation): FabricOptions {
  return {
    ssxId: annotation.id,
    left: annotation.rect.x,
    top: annotation.rect.y,
    width: annotation.rect.width,
    height: annotation.rect.height,
    angle: annotation.rotationDeg,
    opacity: annotation.opacity,
    stroke: annotation.style.stroke,
    strokeWidth: annotation.style.strokeWidth,
    fill: annotation.style.fill === 'none' ? '' : annotation.style.fill,
    selectable: !annotation.locked,
    evented: !annotation.locked,
    visible: annotation.visible,
  };
}
