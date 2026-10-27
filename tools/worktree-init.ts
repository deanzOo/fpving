import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;
const PORT_BASE = 4000;
const PORT_SPAN = 1000;

/** 32-bit FNV-1a hash of the UTF-16 code units of `text`. */
export const fnv1a = (text: string): number => {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME);
  }
  return hash >>> 0;
};

export const portFor = (worktreePath: string): number => PORT_BASE + (fnv1a(worktreePath) % PORT_SPAN);

export interface EnvValues {
  readonly port: number;
  readonly dataDir: string;
}

const replaceLine = (template: string, name: string, value: string): string => {
  const line = new RegExp(`^${name}=.*$`, "m");
  if (!line.test(template)) {
    throw new Error(`.env.example has no ${name}= line`);
  }
  return template.replace(line, () => `${name}=${value}`);
};

export const renderEnv = (template: string, values: EnvValues): string =>
  replaceLine(replaceLine(template, "PORT", String(values.port)), "DATA_DIR", values.dataDir);

export type WorktreeInitResult
  = | { readonly status: "created"; readonly port: number; readonly dataDir: string }
    | { readonly status: "exists" };

/** Writes `.env` from `.env.example` for the worktree at `root`; an existing `.env` is left untouched. */
export const initWorktree = async (root: string): Promise<WorktreeInitResult> => {
  const absolute = resolve(root);
  const target = join(absolute, ".env");
  if (await access(target).then(() => true, () => false)) {
    return { status: "exists" };
  }
  const template = await readFile(join(absolute, ".env.example"), "utf8");
  const values = { port: portFor(absolute), dataDir: join(absolute, ".data", basename(absolute)) };
  await writeFile(target, renderEnv(template, values), { flag: "wx" });
  return { status: "created", ...values };
};
