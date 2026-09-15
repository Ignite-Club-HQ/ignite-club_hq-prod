import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sourcePath = "supabase/functions/send-event-view-reminder/_templates/event-view-reminder.tsx";
const source = readFileSync(sourcePath, "utf8");

type EmailComponent = (props: Record<string, unknown>) => React.ReactElement;
type EventViewReminderEmail = (props: Record<string, unknown>) => React.ReactElement;

function host(tag: keyof React.JSX.IntrinsicElements): EmailComponent {
  return ({ children, ...props }) => React.createElement(tag, props, children as React.ReactNode);
}

async function loadTemplate(): Promise<EventViewReminderEmail> {
  const componentNames = [
    "Body", "Button", "Container", "Head", "Heading", "Hr", "Html", "Img",
    "Link", "Preview", "Section", "Text", "Row", "Column",
  ];
  const tags: Record<string, keyof React.JSX.IntrinsicElements> = {
    Body: "body",
    Button: "a",
    Container: "div",
    Head: "head",
    Heading: "h1",
    Hr: "hr",
    Html: "html",
    Img: "img",
    Link: "a",
    Preview: "span",
    Section: "section",
    Text: "p",
    Row: "div",
    Column: "div",
  };
  const components = Object.fromEntries(componentNames.map((name) => [name, host(tags[name])]));
  Object.assign(globalThis, {
    __eventReminderReact: React,
    __eventReminderComponents: components,
  });

  const instrumented = source
    .replace(
      /import\s+\{[\s\S]*?\}\s+from\s+['"]npm:@react-email\/components@[^'"]+['"]/,
      `const { ${componentNames.join(", ")} } = globalThis.__eventReminderComponents;`,
    )
    .replace(
      /import\s+\*\s+as\s+React\s+from\s+['"]npm:react@[^'"]+['"]/,
      "const React = globalThis.__eventReminderReact;",
    );
  const result = ts.transpileModule(instrumented, {
    fileName: sourcePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    throw new Error(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  }
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputText).toString("base64")}#${crypto.randomUUID()}`;
  const module = await import(/* @vite-ignore */ moduleUrl) as { EventViewReminderEmail: EventViewReminderEmail };
  return module.EventViewReminderEmail;
}

const baseProps = {
  recipientName: "Synthetic Member",
  eventTitle: "Synthetic Training",
  teamName: "Synthetic Team",
  clubName: "Synthetic Club",
  eventDate: "Thursday, 23 July 2026",
  eventTime: "6:00 PM",
  eventLocation: "Synthetic Oval",
  eventType: "training",
  eventLink: "https://untrusted.example/events/synthetic-event?token=secret",
  clubLogoUrl: undefined,
  primaryColor: "#10b981",
};

describe("event-view reminder email security contract", () => {
  let Template: EventViewReminderEmail;

  beforeAll(async () => { Template = await loadTemplate(); });
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).__eventReminderReact;
    delete (globalThis as Record<string, unknown>).__eventReminderComponents;
  });

  function render(overrides: Record<string, unknown> = {}) {
    return `<!doctype html>${renderToStaticMarkup(React.createElement(Template, { ...baseProps, ...overrides }))}`;
  }

  it("escapes an attacker-controlled event title instead of creating email markup", () => {
    const html = render({ eventTitle: '<img src="x" data-injected="event" onerror="alert(1)">' });
    expect(html).not.toContain('<img src="x"');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img");
  });

  it("escapes an attacker-controlled team name in RSVP copy", () => {
    const html = render({ teamName: '<a href="https://evil.example" data-injected="team">Support</a>' });
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("&lt;a");
  });

  it("escapes an attacker-controlled club name in non-RSVP copy", () => {
    const html = render({
      eventType: "social",
      clubName: '<img src="https://evil.example/track" data-injected="club">',
    });
    expect(html).not.toContain('<img src="https://evil.example/track"');
    expect(html).toContain("&lt;img");
  });

  it("normalizes the CTA and fallback link to the production origin", () => {
    const html = render();
    expect(html).toContain('href="https://igniteclubhq.app/events/synthetic-event"');
    expect(html).not.toContain("untrusted.example");
    expect(html).not.toContain("token=secret");
  });

  it("preserves RSVP and non-RSVP wording without requiring raw HTML", () => {
    const rsvp = render({ eventType: "match" });
    const nonRsvp = render({ eventType: "social" });
    expect(rsvp).toContain("RSVP Needed!");
    expect(rsvp).toContain("Your response is needed!");
    expect(nonRsvp).toContain("Don&#x27;t Miss This!");
    expect(nonRsvp).toContain("Your response is needed!");
  });
});
