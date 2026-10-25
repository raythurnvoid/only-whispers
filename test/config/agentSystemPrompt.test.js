const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/config/prompts.ts");

test("the prompt lists what the assistant can do, grouped, before how to use each tool", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt([
    "search_notes",
    "create_note",
    "web_search",
    "copy_to_clipboard",
    {
      name: "slack_send_message",
      connectorId: "slack",
      promptInstruction: "Use slack_send_message…",
    },
    {
      name: "linear_search_issues",
      connectorId: "linear",
      promptInstruction: "Use linear_search…",
    },
    { name: "linear_comment", connectorId: "linear", promptInstruction: "Use linear_comment…" },
  ]);

  assert.match(prompt, /You can use these tools:\n/);
  assert.match(prompt, /^- The user's notes: search_notes, create_note$/m);
  assert.match(prompt, /^- Web search: web_search$/m);
  assert.match(prompt, /^- Clipboard: copy_to_clipboard$/m);
  assert.match(prompt, /^- Slack: slack_send_message$/m);
  assert.match(prompt, /^- Linear: linear_search_issues, linear_comment$/m);
  assert.ok(prompt.indexOf("You can use these tools") < prompt.indexOf("How to use them"));
  assert.match(prompt, /^- Use search_notes to find/m);
  assert.doesNotMatch(prompt, /The user's calendar/);
});

test("the prompt forbids claiming an ability a listed tool covers", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt(["web_search"]);
  assert.match(prompt, /Never tell the user you can't do something one of these tools covers/);
  assert.match(prompt, /never say you can't browse the web when web search is listed/);
  assert.match(prompt, /say that it failed rather than claiming you lack the ability/);
});

test("web search is for anything that may have changed, and when in doubt the model searches", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt(["web_search"]);
  assert.match(
    prompt,
    /Use web_search whenever the answer depends on public information that may have changed/
  );
  assert.match(prompt, /whenever the user asks you to look something up/);
  assert.match(prompt, /search rather than decline/);
  assert.doesNotMatch(prompt, /only-whispers/);
});

test("web search stays on public information the context doesn't already answer", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt(["web_search", "search_notes"]);
  assert.doesNotMatch(prompt, /releases, people,/);
  assert.match(prompt, /Don't search for people the user knows personally/);
  assert.match(prompt, /nor for anything the conversation, the user's notes or the context/);
  assert.match(prompt, /don't call one when the conversation or the context provided here/);
});

test("connector tools group under their connector names", async () => {
  const { getAgentSystemPrompt } = await load();
  const names = { email: "Email", slack: "Slack", linear: "Linear", github: "GitHub" };
  const prompt = getAgentSystemPrompt(
    Object.keys(names).map((connectorId) => ({
      name: `${connectorId}_tool`,
      connectorId,
    }))
  );
  for (const [connectorId, name] of Object.entries(names)) {
    assert.match(prompt, new RegExp(`^- ${name}: ${connectorId}_tool$`, "m"));
  }
});

test("the tool-trace rule rides only with traced history", async () => {
  const { getAgentSystemPrompt } = await load();
  assert.match(
    getAgentSystemPrompt(["web_search"], undefined, { toolTrace: true }),
    /\[Tools used: …\] note .* Never write such a note yourself/
  );
  // A follow-up ("it's #engineering", "retry") must not redo what already went out.
  assert.match(
    getAgentSystemPrompt(["web_search"], undefined, { toolTrace: true }),
    /marked sent or draft opened already happened.*never do it again unless the user asks/
  );
  assert.doesNotMatch(getAgentSystemPrompt(["web_search"]), /Tools used/);
});

test("without tools there is no capability block", async () => {
  const { getAgentSystemPrompt } = await load();
  const bare = getAgentSystemPrompt([]);
  assert.doesNotMatch(bare, /You can use these tools|Never tell the user/);
});
test("the model ends an email without a signature rather than a placeholder", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt(["search_notes"]);
  assert.doesNotMatch(prompt, /The user's name is/);
  assert.match(prompt, /Never leave placeholders such as \[Your Name\]/);
  assert.match(prompt, /without a signature line/);
});

const TONES = { personal: "very_casual", work: "casual", email: "formal", other: "excited" };

test("Tone & Style lists the user's style for each kind of writing, after the sign-off rule", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt([], undefined, {
    writingStyle: { tones: TONES },
  });

  assert.match(prompt, /WRITING STYLE: When you write something the user will send/);
  assert.match(prompt, /^- Personal messages \([^)]*\): very casual, like texting a friend\./m);
  assert.match(prompt, /^- Work messages \([^)]*\): casual and friendly/m);
  assert.match(prompt, /^- Emails \([^)]*email_draft[^)]*\): formal and polished\./m);
  assert.match(prompt, /^- Everything else \([^)]*\): upbeat and enthusiastic\./m);
  assert.match(prompt, /Your own answers, explanations and summaries keep your usual voice\./);
  assert.match(
    prompt,
    /Names, acronyms and dictionary terms keep their exact spelling and capitalization\./
  );
  assert.ok(prompt.indexOf("without a signature line") < prompt.indexOf("WRITING STYLE"));
});

test("an answer typed at the cursor gets that app's style, and tool text keeps its own kind", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt([], undefined, {
    writingStyle: { tones: TONES, destination: "work" },
  });

  assert.match(
    prompt,
    /WRITING STYLE: Your reply will be typed at the user's cursor in a work chat app, as their own words\. Write the reply as only the text that goes there \(no subject line or label\), in the user's work message style: casual and friendly/
  );
  // An email_draft spoken with the cursor in Slack is still written as an email.
  const replyOnly = prompt.indexOf("That style is for the reply only.");
  assert.ok(replyOnly > 0);
  assert.ok(
    prompt.indexOf("- Emails (any email, including an email_draft body): formal") > replyOnly
  );
});

test("an answer typed at the cursor in another app reads naturally", async () => {
  const { getAgentSystemPrompt } = await load();
  const prompt = getAgentSystemPrompt([], undefined, {
    writingStyle: { tones: TONES, destination: "other" },
  });

  assert.match(
    prompt,
    /cursor in an app other than chat or email, as their own words\. .* in the user's general writing style: upbeat and enthusiastic\./
  );
  assert.doesNotMatch(prompt, /Everything else style|cursor in an app,/);
  assert.match(prompt, /code and commands, with their strings and comments, are never restyled/);
});

test("without Tone & Style the prompt has no writing style", async () => {
  const { getAgentSystemPrompt } = await load();
  assert.doesNotMatch(getAgentSystemPrompt([], undefined, {}), /WRITING STYLE/);
});
