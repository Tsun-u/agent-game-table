import type { OptionDescription } from "./types.js";

/** 規則表給人也給 AI 讀，選項值用「開／關」與選項標籤呈現，不露 true／false 或 key。 */
export function displayOptionValue(option: OptionDescription, value: string | number | boolean): string | number {
  if (option.type === "boolean") return value ? "開" : "關";
  if (option.type === "choice") return option.choices.find((choice) => choice.value === value)?.label ?? String(value);
  return value as number;
}
