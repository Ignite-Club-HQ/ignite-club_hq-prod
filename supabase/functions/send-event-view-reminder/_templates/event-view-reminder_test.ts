import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import * as React from "npm:react@18.3.1";
import { EventViewReminderEmail } from "./event-view-reminder.tsx";

async function render(props: Record<string, unknown>): Promise<string> {
  // deno-lint-ignore no-explicit-any
  return await renderAsync(React.createElement(EventViewReminderEmail as any, props));
}

const baseProps = {
  recipientName: "Alex",
  eventTitle: "Team Meeting",
  teamName: "U12 Blue",
  clubName: "Riverside FC",
  eventDate: "Saturday, 25 Jan 2025",
  eventTime: "2:00 PM",
  eventType: "game",
  eventLink: "https://igniteclubhq.app/event/123",
};

Deno.test("event title with img/onerror is escaped, no element or handler is created", async () => {
  const html = await render({
    ...baseProps,
    eventTitle: `<img src="x" onerror="alert(1)">`,
  });
  assert(!/<img\b[^>]*onerror/i.test(html), "must not render an <img> with onerror");
  assert(!/\sonerror\s*=/i.test(html), "must not render a raw onerror attribute");
  assertStringIncludes(html, "&lt;img");
  assertStringIncludes(html, "onerror=&quot;alert(1)&quot;");
});

Deno.test("team name with anchor tag is escaped, no external link created (rsvp variant)", async () => {
  const html = await render({
    ...baseProps,
    eventType: "game",
    teamName: `<a href="https://evil.example">Support</a>`,
  });
  assert(
    !/<a\s+href="https:\/\/evil\.example"/i.test(html),
    "must not render an <a> to evil.example from teamName",
  );
  assertStringIncludes(html, "&lt;a href=&quot;https://evil.example&quot;&gt;Support&lt;/a&gt;");
});

Deno.test("club name with tracking image is escaped, no img created (non-rsvp variant)", async () => {
  const html = await render({
    ...baseProps,
    eventType: "social",
    clubName: `<img src="https://evil.example/track">`,
  });
  assert(
    !/<img[^>]+evil\.example\/track/i.test(html),
    "must not render a tracking <img> from clubName",
  );
  assertStringIncludes(html, "&lt;img src=&quot;https://evil.example/track&quot;&gt;");
});

Deno.test("legitimate punctuation, accents, apostrophes and emoji render intact", async () => {
  const html = await render({
    ...baseProps,
    clubName: "Café O'Neill's 🏆",
    teamName: "L'Équipe Élite",
    eventTitle: "Season's End Bash 🎉",
  });
  assertStringIncludes(html, "Café O&#x27;Neill&#x27;s 🏆");
  assertStringIncludes(html, "L&#x27;Équipe Élite");
  assertStringIncludes(html, "Season&#x27;s End Bash 🎉");
});

Deno.test("RSVP-style wording preserved for game events", async () => {
  const html = await render({ ...baseProps, eventType: "game" });
  assertStringIncludes(html, "RSVP&#x27;d");
  assertStringIncludes(html, "Your response is needed!");
});

Deno.test("Non-RSVP wording preserved for social events", async () => {
  const html = await render({ ...baseProps, eventType: "social" });
  assertStringIncludes(html, "You haven&#x27;t checked out");
  assertStringIncludes(html, "Your response is needed!");
});

Deno.test("CTA and fallback link are normalized to production domain", async () => {
  const html = await render({
    ...baseProps,
    eventLink: "https://preview.example.com/event/abc?x=1",
  });
  assertStringIncludes(html, "https://igniteclubhq.app/event/abc");
  assert(!html.includes("preview.example.com"));
});

Deno.test("template contains no dangerouslySetInnerHTML output artefacts", async () => {
  // Rendered HTML from React shouldn't have unescaped <strong> injected via user values.
  const html = await render({
    ...baseProps,
    eventTitle: "<strong>PWN</strong>",
  });
  assert(!/<strong>PWN<\/strong>/.test(html), "must not render raw <strong> from user input");
  assertStringIncludes(html, "&lt;strong&gt;PWN&lt;/strong&gt;");
});

Deno.test("source file no longer references dangerouslySetInnerHTML", async () => {
  const src = await Deno.readTextFile(new URL("./event-view-reminder.tsx", import.meta.url));
  assert(
    !src.includes("dangerouslySetInnerHTML"),
    "event-view-reminder.tsx must not use dangerouslySetInnerHTML",
  );
});
