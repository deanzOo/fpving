import { useEffect, useRef, useState } from "react";
import { createModelStage } from "./model-stage.ts";
import type { Model, ModelStage } from "./model-stage.ts";
import { Notice, NoticeTone } from "./notice.tsx";

const BRACKET_PADDING_PIXELS = 8;

interface ModelViewProps<Id extends string> {
  readonly label: string;
  readonly build: () => Model<Id>;
  readonly nameOf: (id: Id) => string;
  readonly selected: Id | null;
  readonly onSelect: (id: Id | null) => void;
  readonly exploded: number;
  readonly powered: boolean;
}

/**
 * A 3D model a viewer can turn, zoom and click, with reticle brackets following the selected piece and the name of the
 * hovered one in the corner. Without WebGL it says so, for the screen to offer its list of the same pieces instead.
 *
 * @param props - The canvas's label, the model's builder, the pieces' names, the selection and how far apart and
 * whether powered it is.
 * @returns The view.
 */
export const ModelView = <Id extends string>({
  label, build, nameOf, selected, onSelect, exploded, powered,
}: ModelViewProps<Id>) => {
  const host = useRef<HTMLDivElement>(null);
  const reticle = useRef<HTMLDivElement>(null);
  const stage = useRef<ModelStage<Id> | null>(null);
  const shown = useRef(selected);
  const pick = useRef(onSelect);
  const [hovered, setHovered] = useState<Id | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    pick.current = onSelect;
    shown.current = selected;
  });

  useEffect(() => {
    const container = host.current;
    if (container === null) {
      return undefined;
    }
    const created = createModelStage({
      host: container,
      label,
      model: build(),
      onHover: setHovered,
      onPick: (id) => {
        pick.current(id === shown.current ? null : id);
      },
      onFrame: () => {
        const element = reticle.current;
        if (element !== null && shown.current !== null) {
          const box = stage.current?.boxOf(shown.current);
          if (box !== undefined) {
            element.style.left = `${String(box.left - BRACKET_PADDING_PIXELS)}px`;
            element.style.top = `${String(box.top - BRACKET_PADDING_PIXELS)}px`;
            element.style.width = `${String(box.width + BRACKET_PADDING_PIXELS + BRACKET_PADDING_PIXELS)}px`;
            element.style.height = `${String(box.height + BRACKET_PADDING_PIXELS + BRACKET_PADDING_PIXELS)}px`;
          }
        }
      },
    });
    stage.current = created;
    setUnavailable(created === null);
    return () => {
      created?.dispose();
      stage.current = null;
    };
  }, [build, label]);

  useEffect(() => {
    stage.current?.setSelected(selected);
  }, [selected]);
  useEffect(() => {
    stage.current?.setExplode(exploded);
  }, [exploded]);
  useEffect(() => {
    stage.current?.setPowered(powered);
  }, [powered]);

  if (unavailable) {
    return (
      <Notice tone={NoticeTone.Warning} tag="NO 3D">
        This browser can&apos;t show the 3D model. Everything about it is still in the list of pieces.
      </Notice>
    );
  }
  return (
    <div className="relative h-full min-h-96 overflow-hidden">
      <div ref={host} className="size-full" />
      <p aria-hidden="true" className="pointer-events-none absolute left-2 top-2 text-signal type-label">
        {hovered === null ? "" : nameOf(hovered)}
      </p>
      {selected === null
        ? null
        : <div ref={reticle} data-testid="reticle" className="reticle pointer-events-none absolute!" />}
    </div>
  );
};
