import type { CliIo, ParsedArgs } from "./cli.js";
import type { ToolContext } from "./tools/context.js";

export async function runCommand(args: ParsedArgs, _ctx: ToolContext, io: CliIo): Promise<number> {
  io.error(`"${args.command}" is not implemented yet.`);
  return 2;
}
