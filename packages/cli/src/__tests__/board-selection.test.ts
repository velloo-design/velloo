import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { multiselect } from "@clack/prompts";
import { type BoardEntry, boardSelectionPrompt, resolveBoardSelection } from "../folder.ts";

const boards: BoardEntry[] = [
  { id: "home", name: "Home", screens: ["landing"] },
  { id: "checkout", name: "Checkout", screens: ["cart", "payment"] },
];

async function runBoardPrompt(keys: string): Promise<string[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const result = multiselect<string>({
    ...boardSelectionPrompt(boards),
    input,
    output,
  });

  await Bun.sleep(0);
  input.write(keys);
  const selected = await result;
  input.end();
  output.end();
  return selected as string[];
}

describe("interactive publish board selection", () => {
  test("starts empty and an empty confirmation stops the flow", async () => {
    expect(boardSelectionPrompt(boards).initialValues).toEqual([]);
    const selected = await runBoardPrompt("\r");
    expect(selected).toEqual([]);
    expect(resolveBoardSelection(boards, selected)).toBeNull();
  });

  test("a selects every board and pressing a again clears all", async () => {
    expect(await runBoardPrompt("a\r")).toEqual(["home", "checkout"]);
    expect(await runBoardPrompt("aa\r")).toEqual([]);
  });
});
