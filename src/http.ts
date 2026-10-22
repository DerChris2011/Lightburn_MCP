import type { CliIo } from "./cli.js";
import type { ToolContext } from "./tools/context.js";

export async function runHttpCommand(_ctx: ToolContext, _flags: Record<string, string | boolean>, io: CliIo): Promise<number> {
  io.error("--http is not implemented yet.");
  return 2;
}
