import "side-effect-pkg";
import { single } from './single-quoted.ts';
import type { Shape } from "typed-pkg";

export const load = async () => import("dynamic-pkg");
export { single };
export type { Shape };
