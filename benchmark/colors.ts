import { styleText } from "node:util";

// Minimal chalk replacement built on node:util's styleText (stable since
// v22.13), which handles TTY detection and NO_COLOR/FORCE_COLOR for us.
// Formats are applied one at a time for compatibility with all of Node 22.x.
const style =
  (...formats: Parameters<typeof styleText>[0][]) =>
  (text: string) =>
    formats.reduce((styled, format) => styleText(format, styled), text);

export const colors = {
  red: style("red"),
  green: style("green"),
  yellow: style("yellow"),
  gray: style("gray"),
  cyan: style("cyan"),
  bold: {
    red: style("bold", "red"),
    yellow: style("bold", "yellow"),
    cyan: style("bold", "cyan"),
  },
};
