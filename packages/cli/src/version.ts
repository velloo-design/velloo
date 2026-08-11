import pkg from "../package.json" with { type: "json" };

export const TOOL_VERSION: string = pkg.version;
