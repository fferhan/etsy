const ESC = "";
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const paint = (code, text) => (useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text);

export const log = {
  info: (...args) => console.log(paint("36", "i"), ...args),
  ok: (...args) => console.log(paint("32", "ok"), ...args),
  warn: (...args) => console.warn(paint("33", "!"), ...args),
  error: (...args) => console.error(paint("31", "x"), ...args),
  step: (...args) => console.log(paint("35", ">"), ...args),
  plain: (...args) => console.log(...args),
  dim: (text) => paint("2", text),
  bold: (text) => paint("1", text),
};

/** Uzun islemlerde tek satirlik ilerleme gostergesi. */
export function progress(done, total, label = "") {
  if (!process.stdout.isTTY) return;
  const width = 24;
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  const bar = "#".repeat(filled) + "-".repeat(width - filled);
  process.stdout.write(`\r  ${bar} ${done}/${total} ${label.slice(0, 40).padEnd(40)}`);
  if (done === total) process.stdout.write("\n");
}
