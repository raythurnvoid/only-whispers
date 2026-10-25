const test = require("node:test");
const assert = require("node:assert/strict");
const i18next = require("i18next");
const { I18nextProvider } = require("react-i18next");
const { React, renderStatic } = require("./harness/reactSsr");

test("the empty Assistant offers two localized generic suggestions", async () => {
  await i18next.init({
    lng: "en",
    resources: {
      en: {
        translation: {
          assistant: {
            panel: {
              suggestions: {
                draft: "Help me draft something",
                dictionary: "Add a word to my dictionary",
              },
            },
          },
        },
      },
    },
  });

  const { AssistantEmptyState } =
    await import("../../src/components/dictation/AssistantEmptyState.tsx");
  const markup = renderStatic(
    I18nextProvider,
    { i18n: i18next },
    React.createElement(AssistantEmptyState, {
      disabled: true,
      onSelectSuggestion: () => {},
    })
  );

  assert.match(markup, /Help me draft something/);
  assert.match(markup, /Add a word to my dictionary/);
  assert.equal((markup.match(/<button/g) ?? []).length, 2);
  assert.equal((markup.match(/ disabled=""/g) ?? []).length, 2);
});
