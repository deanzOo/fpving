import { useState } from "react";
import { ESC_GUIDE, ESC_PIECE_GUIDES } from "./esc-guide.ts";
import { buildEsc, EscPiece } from "./esc-model.ts";
import { MOTOR_GUIDE, MOTOR_PIECE_GUIDES } from "./motor-guide.ts";
import type { PartGuide } from "./motor-guide.ts";
import { buildMotor, MotorPiece } from "./motor-model.ts";
import { Button, ButtonSize, ButtonVariant } from "./ui/button.tsx";
import type { Model } from "./ui/model-stage.ts";
import { ModelView } from "./ui/model-view.tsx";
import { Panel } from "./ui/panel.tsx";
import { Slider } from "./ui/slider.tsx";

const APART = 100;
const LIST_ITEM = "w-full justify-start";
const CURRENT_ITEM = "bg-signal-soft text-ink";
const SLOWED = "Slowed right down to show the coils taking turns.";

interface AtlasPart<Id extends string> {
  readonly label: string;
  readonly intro: string;
  readonly build: () => Model<Id>;
  readonly pieces: readonly Id[];
  readonly guide: PartGuide;
  readonly pieceGuides: Readonly<Record<Id, PartGuide>>;
  readonly powers: boolean;
}

const MOTOR: AtlasPart<MotorPiece> = {
  label: "3D model of a brushless motor. Every piece is also in the list of pieces.",
  intro: "Shown here: a typical 2207 motor.",
  build: buildMotor,
  pieces: Object.values(MotorPiece),
  guide: MOTOR_GUIDE,
  pieceGuides: MOTOR_PIECE_GUIDES,
  powers: true,
};

const ESC: AtlasPart<EscPiece> = {
  label: "3D model of a 4-in-1 ESC. Every piece is also in the list of pieces.",
  intro: "Shown here: a typical 30×30 4-in-1 ESC for a 5 inch quad.",
  build: buildEsc,
  pieces: Object.values(EscPiece),
  guide: ESC_GUIDE,
  pieceGuides: ESC_PIECE_GUIDES,
  powers: false,
};

const Fact = ({ title, children }: { readonly title: string; readonly children: string }) => (
  <>
    <h3 className="mt-4 text-ink-muted type-label">{title}</h3>
    <p className="mt-1 type-body">{children}</p>
  </>
);

const PartAtlas = <Id extends string>({ part }: { readonly part: AtlasPart<Id> }) => {
  const [selected, setSelected] = useState<Id | null>(null);
  const [exploded, setExploded] = useState(0);
  const [powered, setPowered] = useState(false);
  const guide = selected === null ? part.guide : part.pieceGuides[selected];
  const nameOf = (piece: Id): string => part.pieceGuides[piece].name;
  return (
    <>
      <p className="mt-2 text-ink-muted type-body">
        Turn the part, take it apart and click a piece to see what it does. {part.intro}
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[10rem_minmax(0,1fr)_18rem]">
        <div className="order-3 lg:order-1">
          <h2 className="text-ink-muted type-label">Pieces</h2>
          <ul className="mt-2">
            {part.pieces.map((piece) => (
              <li key={piece}>
                <Button
                  variant={ButtonVariant.Ghost}
                  size={ButtonSize.Small}
                  aria-current={piece === selected}
                  className={`${LIST_ITEM} ${piece === selected ? CURRENT_ITEM : ""}`}
                  onClick={() => {
                    setSelected(piece === selected ? null : piece);
                  }}
                >
                  {nameOf(piece)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          <Panel>
            <ModelView
              label={part.label}
              build={part.build}
              nameOf={nameOf}
              selected={selected}
              onSelect={setSelected}
              exploded={exploded / APART}
              powered={powered}
            />
          </Panel>
          <div className="flex flex-wrap items-center gap-3">
            <Slider label="Explode" value={exploded} onChange={setExploded} />
            <Button
              onClick={() => {
                setExploded(exploded === APART ? 0 : APART);
              }}
            >
              {exploded === APART ? "Put together" : "Take apart"}
            </Button>
            {part.powers
              ? (
                  <Button
                    aria-pressed={powered}
                    onClick={() => {
                      setPowered(!powered);
                    }}
                  >
                    {powered ? "Power off" : "Power on"}
                  </Button>
                )
              : null}
            {powered ? <p className="text-ink-muted type-body">{SLOWED}</p> : null}
          </div>
        </div>
        <div aria-live="polite" className="order-2 lg:order-3">
          <h2 className="type-heading">{guide.name}</h2>
          <p className="mt-2 type-body">{guide.what}</p>
          <Fact title="How it works">{guide.how}</Fact>
          <Fact title="What goes wrong">{guide.fails}</Fact>
          <Fact title="What to look at">{guide.specs}</Fact>
        </div>
      </div>
    </>
  );
};

const PARTS = [
  { name: "Motor", show: () => <PartAtlas part={MOTOR} /> },
  { name: "ESC", show: () => <PartAtlas part={ESC} /> },
] as const;

/**
 * The parts atlas: a 3D part to turn, take apart and click, with what each piece does beside it, and a choice of
 * which part to look at.
 *
 * @returns The screen.
 */
export const Atlas = () => {
  const [shown, setShown] = useState<(typeof PARTS)[number]>(PARTS[0]);
  return (
    <section>
      <h1 className="type-title">Atlas</h1>
      <nav aria-label="Parts" className="mt-3 flex gap-1">
        {PARTS.map((part) => (
          <Button
            key={part.name}
            variant={ButtonVariant.Ghost}
            aria-current={part === shown}
            className={part === shown ? CURRENT_ITEM : ""}
            onClick={() => {
              setShown(part);
            }}
          >
            {part.name}
          </Button>
        ))}
      </nav>
      <shown.show key={shown.name} />
    </section>
  );
};
