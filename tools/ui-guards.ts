/** The pattern of a raw colour: hex, `rgb()`, `hsl()` or `oklch()`. */
export const RAW_COLOUR = String.raw`#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b`
  + String.raw`(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color|color-mix)\(`;
/** What a raw colour breaks and what to use instead. */
export const RAW_COLOUR_MESSAGE = "Design system rule 1 (only tokens): raw colour. "
  + "Use a token from apps/ui/design/tokens.json, through a utility such as text-ink or var(--color-ink).";

const COLOUR_UTILITY = "(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|outline|fill|stroke|decoration|accent|caret"
  + "|divide|placeholder|shadow|from|via|to)";
const PALETTE = "(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink"
  + String.raw`|rose|slate|gray|zinc|neutral|stone)-\d{2,3}|black|white)`;
const PALETTE_CLASS = String.raw`\b${COLOUR_UTILITY}-${PALETTE}\b`;
const PALETTE_MESSAGE = "Design system rule 1 (only tokens): Tailwind palette class, which compiles to nothing here. "
  + "Use a token utility such as text-ink or bg-surface.";
const ARBITRARY_COLOUR_CLASS = String.raw`\b${COLOUR_UTILITY}-[\[(]`;
const ARBITRARY_MESSAGE = "Design system rule 1 (only tokens): arbitrary value on a colour utility. "
  + "Use a token utility such as text-ink or bg-surface.";

const ARBITRARY_PROPERTY_CLASS = String.raw`(?:^|[\s:!])\[-{0,2}[a-z][a-z-]*:(?:\S|$)`;
const ARBITRARY_PROPERTY_MESSAGE = "Design system rule 1 (only tokens): arbitrary property class. "
  + "Use a token or type-* utility, or extend a primitive.";

const OPACITY_CLASS = String.raw`\bopacity-`;
const OPACITY_MESSAGE = "Design system rule 7 (pending): opacity class. "
  + "Pending is aria-disabled and a changed label: use Button's pending and pendingLabel props.";

const RAW_TYPE_CLASS = String.raw`\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b`
  + String.raw`|\bfont-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b|\bfont-[\[(]`
  + String.raw`|\bleading-|\btracking-`;
const RAW_TYPE_MESSAGE = "Design system type rule: raw text size, font weight, leading or tracking. "
  + "Use a type-* utility such as type-body, type-heading or type-readout.";

const SHAPE_CLASS = String.raw`\brounded-|\bshadow-`;
const SHAPE_MESSAGE = "Design system shape rule: radius or shadow class. No pills, and the one shadow is on Confirm. "
  + "Use a primitive, which carries its radius, or extend one.";

const INLINE_STYLE_MESSAGE = "Design system rule 1 (only tokens): inline style outside apps/ui/src/ui. "
  + "Use a token or type-* utility, or extend a primitive.";

const PRIMITIVE_FOR_NATIVE = {
  button: "Button",
  input: "TextField or Checkbox",
  select: "Select",
  textarea: "TextField, extended for several lines",
  table: "DataTable",
  dialog: "Confirm",
} as const;

const stringGuard = (pattern: string, message: string) => [
  { selector: `Literal[value=/${pattern}/i]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/i]`, message },
];

/** The `no-restricted-syntax` entries for all of `apps/ui/src`, primitives included. */
export const uiSourceGuards = stringGuard(RAW_COLOUR, RAW_COLOUR_MESSAGE);

/** The `no-restricted-syntax` entries for `apps/ui/src` outside the primitives in `apps/ui/src/ui`. */
export const uiScreenGuards = [
  ...uiSourceGuards,
  ...stringGuard(PALETTE_CLASS, PALETTE_MESSAGE),
  ...stringGuard(ARBITRARY_COLOUR_CLASS, ARBITRARY_MESSAGE),
  ...stringGuard(ARBITRARY_PROPERTY_CLASS, ARBITRARY_PROPERTY_MESSAGE),
  ...stringGuard(OPACITY_CLASS, OPACITY_MESSAGE),
  ...stringGuard(RAW_TYPE_CLASS, RAW_TYPE_MESSAGE),
  ...stringGuard(SHAPE_CLASS, SHAPE_MESSAGE),
  { selector: "JSXAttribute[name.name=\"style\"]", message: INLINE_STYLE_MESSAGE },
  ...Object.entries(PRIMITIVE_FOR_NATIVE).map(([element, primitive]) => ({
    selector: `JSXOpeningElement[name.name="${element}"]`,
    message: `Design system rule 2 (shared primitives): native <${element}> outside apps/ui/src/ui. Use ${primitive}.`,
  })),
];
