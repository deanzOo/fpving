/**
 * A labelled range from 0 to 100.
 *
 * @param props - The label, the current value and what to do when it changes.
 * @returns The slider.
 */
export const Slider = ({ label, value, onChange }: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) => (
  <label className="inline-flex items-center gap-2 type-label text-ink-muted">
    {label}
    <input
      type="range"
      min="0"
      max="100"
      value={value}
      className="h-(--control-height) w-40 cursor-pointer accent-signal"
      onChange={({ target }) => {
        onChange(Number(target.value));
      }}
    />
  </label>
);
