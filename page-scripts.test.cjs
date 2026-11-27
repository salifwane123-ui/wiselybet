// Every inline <script> in every page must parse: one syntax error stops the whole script, which can blank a page.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { Script } = require("node:vm");

const pages = readdirSync(__dirname).filter(name => name.endsWith(".html")).sort();

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
    .map(match => ({
      code: match[2],
      line: html.slice(0, match.index).split("\n").length,
      type: (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(match[1])?.[1] || "text/javascript").toLowerCase()
    }));
}

test("the checker finds the site's pages and scripts", () => {
  for (const page of ["index.html", "login.html", "subscribe.html", "game.html", "terms.html", "privacy.html", "responsible-gaming.html", "404.html"]) {
    assert.ok(pages.includes(page), `${page} is missing`);
  }
  assert.ok(inlineScripts(readFileSync(join(__dirname, "index.html"), "utf8")).length >= 5, "index.html's inline scripts were not found");
});

for (const page of pages) {
  test(`${page}: every inline script parses`, () => {
    for (const { code, line, type } of inlineScripts(readFileSync(join(__dirname, page), "utf8"))) {
      if (/json$/.test(type)) {
        assert.doesNotThrow(() => JSON.parse(code), `${page}: the JSON script on line ${line} is invalid`);
      } else if (/^(text|application)\/(x-)?(javascript|ecmascript)$/.test(type)) {
        try {
          new Script(code, { filename: page, lineOffset: line - 1 });
        } catch (error) {
          assert.fail(`${page}: the inline script starting on line ${line} doesn't parse.\n${error.stack}`);
        }
      } else {
        assert.fail(`${page}: line ${line} has a <script type="${type}"> this test can't check yet`);
      }
    }
  });
}
