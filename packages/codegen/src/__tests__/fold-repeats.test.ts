import { describe, expect, test } from "bun:test";
import { foldRepeats } from "../emit-code/fold-repeats.ts";

const fold = (parts: string[]): string => foldRepeats(parts, "  ", "  ").join("\n");

const card = (label: string, value: string, tone: string): string =>
  [
    `  <div className="rounded-lg border p-5 ${tone}">`,
    `    <p className="text-sm text-muted-foreground">${label}</p>`,
    `    <span className="text-3xl font-bold">${value}</span>`,
    "  </div>",
  ].join("\n");

describe("foldRepeats", () => {
  test("look-alike siblings become one template over their values", () => {
    expect(
      fold([
        card("Active users", "8,420", "bg-card"),
        card("Revenue", "$48.2k", "bg-card"),
        card("Avg. session", "4m 38s", "bg-card"),
        card("Open incidents", "17", "bg-card"),
        card("Churn", "1.9%", "bg-destructive/10"),
      ]),
    ).toBe(
      [
        "  {[",
        '    { className: "bg-card", text: "Active users", text2: "8,420" },',
        '    { className: "bg-card", text: "Revenue", text2: "$48.2k" },',
        '    { className: "bg-card", text: "Avg. session", text2: "4m 38s" },',
        '    { className: "bg-card", text: "Open incidents", text2: "17" },',
        '    { className: "bg-destructive/10", text: "Churn", text2: "1.9%" },',
        "  ].map((item, index) => (",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted source holds a template string
        "    <div key={index} className={`rounded-lg border p-5 ${item.className}`}>",
        '      <p className="text-sm text-muted-foreground">{item.text}</p>',
        '      <span className="text-3xl font-bold">{item.text2}</span>',
        "    </div>",
        "  ))}",
      ].join("\n"),
    );
  });

  test("a value that never varies stays in the template", () => {
    const folded = fold([card("A", "1", "x"), card("B", "2", "x"), card("C", "3", "x")]);
    expect(folded).toContain('<div key={index} className="rounded-lg border p-5 x">');
    expect(folded).toContain('{ text: "A", text2: "1" },');
  });

  test("brace values keep their type, and attribute names become keys", () => {
    const bar = (height: number, label: string, on: boolean): string =>
      `  <div className="w-full rounded-t-md bg-primary/80 transition-all hover:bg-primary" style={{ height: "${height}%" }} aria-label="${label}" data-on={${on}} />`;
    expect(
      fold([
        bar(40, "Jan", true),
        bar(65, "Feb", false),
        bar(52, "Mar", true),
        bar(78, "Apr", true),
      ]),
    ).toBe(
      [
        "  {[",
        '    { style: { height: "40%" }, ariaLabel: "Jan", dataOn: true },',
        '    { style: { height: "65%" }, ariaLabel: "Feb", dataOn: false },',
        '    { style: { height: "52%" }, ariaLabel: "Mar", dataOn: true },',
        '    { style: { height: "78%" }, ariaLabel: "Apr", dataOn: true },',
        "  ].map((item, index) => (",
        '    <div key={index} className="w-full rounded-t-md bg-primary/80 transition-all hover:bg-primary" style={item.style} aria-label={item.ariaLabel} data-on={item.dataOn} />',
        "  ))}",
      ].join("\n"),
    );
  });

  test("shared words at the end of a value stay in the template too", () => {
    const chip = (tone: string, label: string): string =>
      `  <span className="${tone} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold">${label}</span>`;
    const folded = fold([
      chip("bg-primary/10 text-primary", "Done"),
      chip("bg-secondary", "Scheduled"),
      chip("bg-primary/10 text-primary", "Shipped"),
      chip("bg-secondary", "Queued"),
      chip("bg-destructive/10 text-destructive", "Attention"),
    ]);
    expect(folded).toContain('{ className: "bg-primary/10 text-primary", text: "Done" },');
    expect(folded).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted source holds a template string
      "className={`${item.className} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold`}",
    );
  });

  test("places that hold the same value in every row share one field", () => {
    const row = (name: string, tone: string, border: string): string =>
      [
        "  <tr>",
        `    <td className="h-14 px-4 font-semibold ${border}">${name}</td>`,
        `    <td className="h-14 px-4 ${border}">`,
        `      <svg className="size-4 ${tone}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" />`,
        `      <span className="text-xs font-bold leading-5 ${tone}">${name}</span>`,
        "    </td>",
        "  </tr>",
      ].join("\n");
    const folded = fold([
      row("Aurora", "text-green-600", "border-b"),
      row("Beacon", "text-green-600", "border-b"),
      row("Cobalt", "text-red-600", "border-b"),
      row("Drift", "text-red-600", ""),
    ]);
    expect(folded).toContain(
      '{ className: "border-b", text: "Aurora", className2: "text-green-600" },',
    );
    expect(folded).toContain('{ className: "", text: "Drift", className2: "text-red-600" },');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted source holds a template string
    expect(folded.split("${item.className}")).toHaveLength(3);
    expect(folded.split("{item.text}")).toHaveLength(3);
  });

  test("identical siblings repeat by count", () => {
    const star = '  <Star className="h-4 w-4 fill-primary text-primary" aria-hidden="true" />';
    expect(fold([star, star, star, star, star])).toBe(
      [
        "  {Array.from({ length: 5 }, (_, index) => (",
        '    <Star key={index} className="h-4 w-4 fill-primary text-primary" aria-hidden="true" />',
        "  ))}",
      ].join("\n"),
    );
  });

  test("only a run is folded; what sits around it is left as written", () => {
    const row = (name: string): string =>
      `  <tr className="border-b border-border transition-colors hover:bg-muted/50">\n    <td className="px-4 py-3 text-sm font-medium">${name}</td>\n  </tr>`;
    const out = foldRepeats(
      [
        '  <h2 className="text-lg font-semibold">Teams</h2>',
        row("Aurora"),
        row("Beacon"),
        row("Cobalt"),
        "  <Footer />",
      ],
      "  ",
      "  ",
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('  <h2 className="text-lg font-semibold">Teams</h2>');
    expect(out[1]).toContain('{ text: "Aurora" },');
    expect(out[2]).toBe("  <Footer />");
  });

  test("two siblings, different shapes, or text lines are not a list", () => {
    const two = [card("A", "1", "x"), card("B", "2", "x")];
    expect(foldRepeats(two, "  ", "  ")).toEqual(two);
    const shapes = [card("A", "1", "x"), card("B", "2", "x"), "  <hr />", card("C", "3", "x")];
    expect(foldRepeats(shapes, "  ", "  ")).toEqual(shapes);
    // A boolean attribute present on one is a different element, not a value.
    const flags = [
      "  <Tab active>One of the tabs</Tab>",
      "  <Tab>Another of the tabs</Tab>",
      "  <Tab>And a third tab</Tab>",
    ];
    expect(foldRepeats(flags, "  ", "  ")).toEqual(flags);
    const text = ["  One", "  Two", "  Three"];
    expect(foldRepeats(text, "  ", "  ")).toEqual(text);
  });

  test("text that needed escaping keeps its expression, and a slot's element rides in the row", () => {
    const item = (icon: string, label: string): string =>
      `  <NavLink icon={<${icon} className="h-4 w-4" />} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent">\n    ${label}\n  </NavLink>`;
    const folded = fold([
      item("IconHome", '{"Q&A"}'),
      item("IconBolt", "Jobs"),
      item("IconUser", "Team"),
    ]);
    expect(folded).toContain('{ icon: <IconHome className="h-4 w-4" />, text: "Q&A" },');
    expect(folded).toContain('{ icon: <IconBolt className="h-4 w-4" />, text: "Jobs" },');
    expect(folded).toContain("<NavLink key={index} icon={item.icon} className=");
  });

  test("siblings whose own lists differ are left written out", () => {
    const section = (rows: string): string =>
      `  <section className="rounded-lg border border-border bg-card p-4 shadow-sm">\n    {[\n${rows}\n    ].map((item, index) => (\n      <p key={index}>{item.text}</p>\n    ))}\n  </section>`;
    const parts = [
      section('      { text: "a" },\n      { text: "b" },\n      { text: "c" },'),
      section('      { text: "d" },\n      { text: "e" },\n      { text: "f" },'),
      section('      { text: "g" },\n      { text: "h" },\n      { text: "i" },'),
    ];
    expect(foldRepeats(parts, "  ", "  ")).toEqual(parts);
  });

  test("nothing is folded where it would not be shorter", () => {
    const parts = ["  <br />", "  <br />", "  <br />"];
    expect(foldRepeats(parts, "  ", "  ")).toEqual(parts);
  });
});
