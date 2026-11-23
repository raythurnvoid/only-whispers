const test = require("node:test");
const assert = require("node:assert/strict");

const { extractCorrections } = require("../../src/utils/correctionLearner.js");

test("null or empty inputs yield no corrections", () => {
  assert.deepEqual(extractCorrections(null, "hello", []), []);
  assert.deepEqual(extractCorrections("hello", null, []), []);
  assert.deepEqual(extractCorrections("", "hello", []), []);
  assert.deepEqual(extractCorrections("hello", "", []), []);
});

test("identical texts yield no corrections", () => {
  assert.deepEqual(extractCorrections("hello world", "hello world", []), []);
});

test("a misheard product name fixed by the user is learned", () => {
  const result = extractCorrections(
    "We store it in Supabass now",
    "We store it in Supabase now",
    []
  );
  assert.deepEqual(result, ["Supabase"]);
});

test("corrections already in the dictionary are not re-learned, case-insensitively", () => {
  const original = "We store it in Supabass now";
  const edited = "We store it in Supabase now";

  assert.deepEqual(extractCorrections(original, edited, ["Supabase"]), []);
  assert.deepEqual(extractCorrections(original, edited, ["supabase"]), []);
});

test("a wholesale rewrite is not mistaken for corrections", () => {
  const result = extractCorrections("the cat sat on the mat", "a dog stood under a rug", []);
  assert.deepEqual(result, []);
});

test("very short replacements are ignored — two-letter words are edits, not vocabulary", () => {
  const result = extractCorrections("I went to see XX today", "I went to see Al today", []);
  assert.ok(!result.includes("Al"));
});

test("unrelated word swaps are filtered by edit distance — cat to elephant is a rewrite, not a mishearing", () => {
  const result = extractCorrections("I saw a cat yesterday", "I saw a elephant yesterday", []);
  assert.ok(!result.includes("elephant"));
});

test("swapping one everyday word for another is a content edit, not vocabulary", () => {
  const original = "This is why I'm speaking";
  assert.deepEqual(extractCorrections(original, "This is what I'm speaking", []), []);
  assert.deepEqual(extractCorrections(original, "This is where I'm speaking", []), []);
});

test("a misheard English word is not learned, with any ending or capital", () => {
  assert.deepEqual(extractCorrections("I except the offer", "I accept the offer", []), []);
  assert.deepEqual(extractCorrections("It effects everyone", "It affects everyone", []), []);
  assert.deepEqual(extractCorrections("Except it please", "Accept it please", []), []);
});

test("common Italian first names and surnames are not learned", () => {
  assert.deepEqual(extractCorrections("Ask Julia about it", "Ask Giulia about it", []), []);
  assert.deepEqual(extractCorrections("Ask Kiara about it", "Ask Chiara about it", []), []);
  assert.deepEqual(extractCorrections("Call Mister Bernaskoni", "Call Mister Bernasconi", []), []);
  assert.deepEqual(extractCorrections("Call Mister Exposito", "Call Mister Esposito", []), []);
});

test("common first names, days and places are not learned", () => {
  assert.deepEqual(extractCorrections("Hey Shunade how are you", "Hey Sinead how are you", []), []);
  assert.deepEqual(extractCorrections("Ask Sera about it", "Ask Sarah about it", []), []);
  assert.deepEqual(extractCorrections("Ask Lorenso about it", "Ask Lorenzo about it", []), []);
  assert.deepEqual(extractCorrections("See you on Munday", "See you on monday", []), []);
  assert.deepEqual(extractCorrections("We fly to Londen", "We fly to London", []), []);
});

test("a non-array dictionary is tolerated", () => {
  const result = extractCorrections("Hey Supabass", "Hey Supabase", null);
  assert.deepEqual(result, ["Supabase"]);
});

test("the same correction appearing twice is only learned once", () => {
  const result = extractCorrections(
    "Supabass said hi to Supabass",
    "Supabase said hi to Supabase",
    []
  );
  assert.deepEqual(result, ["Supabase"]);
});
