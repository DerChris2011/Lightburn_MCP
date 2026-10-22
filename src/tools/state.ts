import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";

const CAP = "state" as const;

export function registerStateTools(server: McpServer, ctx: ToolContext): void {
  const simple = (name: string, path: string, description: string, note?: string) => {
    server.registerTool(name, { description: `Requires capability "${CAP}". ${description}` }, async () => {
      try {
        ctx.requireCapability(CAP);
        return ctx.textResult(await ctx.client().getJson(path), note);
      } catch (e) {
        return ctx.errorResult(e);
      }
    });
  };

  simple(
    "get_status",
    "/api/status",
    "Connection status and device capabilities of the selected device profile (device_name, connected, supports_z, supports_overrides).",
    "Note: connected=false is the normal resting state on Ruida and similar controllers; it is not a fault.",
  );
  simple("get_position", "/api/position", "Current machine and workpiece coordinates, always in mm. Axes the controller does not report are omitted.");
  simple(
    "get_units",
    "/api/units",
    "The user's display units: `units` is the speed unit (mm/s, mm/min, in/s, in/min), `distance_units` the distance unit (mm, in). They are independent; never infer one from the other.",
  );
  simple("get_jog_settings", "/api/jog/settings", "Current jog distance and speed settings in display units.");
  simple("get_saved_positions", "/api/goto/saved", "Saved positions from the device profile.");
  simple(
    "get_state_snapshot",
    "/api/events/poll",
    "Latest state snapshot in one call: position, job state and progress, speed/power overrides, aux state, connection and jog settings. On Ruida controllers job.state is always idle and progress is never reported.",
  );
}
