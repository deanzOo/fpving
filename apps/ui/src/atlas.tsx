import { useState } from "react";
import { MOTOR_GUIDE, MOTOR_PIECE_GUIDES } from "./motor-guide.ts";
import { buildMotor, MotorPiece } from "./motor-model.ts";
import { Button, ButtonSize, ButtonVariant } from "./ui/button.tsx";
import { ModelView } from "./ui/model-view.tsx";
import { Panel } from "./ui/panel.tsx";
import { Slider } from "./ui/slider.tsx";

const PIECES = Object.values(MotorPiece);
const APART = 100;
const LIST_ITEM = "w-full justify-start";
const CURRENT_ITEM = "bg-signal-soft text-ink";
const SLOWED = "Slowed right down to show the coils taking turns.";

const nameOf = (piece: MotorPiece): string => MOTOR_PIECE_GUIDES[piece].name;

const Fact = ({ title, children }: { readonly title: string; readonly children: string }) => (
  <>
    <h3 className="mt-4 text-ink-muted type-label">{title}</h3>
    <p className="mt-1 type-body">{children}</p>
  </>
);

/**
 * The parts atlas: a 3D motor to turn, take apart and click, with what each piece does beside it.
 *
 * @returns The screen.
 */
export const Atlas = () => {
  const [selected, setSelected] = useState<MotorPiece | null>(null);
  const [exploded, setExploded] = useState(0);
  const [powered, setPowered] = useState(false);
  const guide = selected === null ? MOTOR_GUIDE : MOTOR_PIECE_GUIDES[selected];
  return (
    <section>
      <h1 className="type-title">Atlas</h1>
      <p className="mt-2 text-ink-muted type-body">
        Turn the part, take it apart and click a piece to see what it does. Shown here: a typical 2207 motor.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[10rem_minmax(0,1fr)_18rem]">
        <div className="order-3 lg:order-1">
          <h2 className="text-ink-muted type-label">Pieces</h2>
          <ul className="mt-2">
            {PIECES.map((piece) => (
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
              label="3D model of a brushless motor. Every piece is also in the list of pieces."
              build={buildMotor}
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
            <Button
              aria-pressed={powered}
              onClick={() => {
                setPowered(!powered);
              }}
            >
              {powered ? "Power off" : "Power on"}
            </Button>
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
    </section>
  );
};
