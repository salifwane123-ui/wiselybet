(function (root) {
  const specialLetters = { "ø": "o", "ł": "l", "đ": "d", "ß": "ss", "æ": "ae", "œ": "oe", "ı": "i", "ð": "d", "þ": "th" };
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  // Scores at or above this match the whole query; lower scores only share some of its words.
  const fullMatch = 30;

  // "Luka Dončić", "P.J. Washington" and "Martin Ødegaard" become "luka doncic", "pj washington", "martin odegaard".
  function normalize(name) {
    return String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[øłđßæœıðþ]/g, letter => specialLetters[letter])
      .replace(/['’ʻʼ`´.]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Generational suffixes are dropped so "Michael Porter Jr." and "Michael Porter" are the same name.
  function prepare(name) {
    const words = normalize(name).split(" ").filter(Boolean);
    const kept = words.length > 1 ? words.filter(word => !suffixes.has(word)) : words;
    const tokens = kept.length ? kept : words;
    const starts = [];
    let offset = 0;
    for (const token of tokens) {
      starts.push(offset);
      offset += token.length;
    }
    return { tokens, compact: tokens.join(""), initials: tokens.map(token => token[0]).join(""), starts };
  }

  const typoLimit = length => length >= 7 ? 2 : length >= 4 ? 1 : 0;

  // Optimal string alignment distance, stopping as soon as it must exceed max.
  function withinEdits(first, second, max) {
    if (Math.abs(first.length - second.length) > max) return false;
    let before = null;
    let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
    for (let i = 1; i <= first.length; i += 1) {
      const current = [i];
      let lowest = i;
      for (let j = 1; j <= second.length; j += 1) {
        let cost = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (first[i - 1] === second[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && first[i - 1] === second[j - 2] && first[i - 2] === second[j - 1]) cost = Math.min(cost, before[j - 2] + 1);
        current[j] = cost;
        lowest = Math.min(lowest, cost);
      }
      if (lowest > max) return false;
      before = previous;
      previous = current;
    }
    return previous[second.length] <= max;
  }

  // 4 = same word, 3 = the start of the word, 2 = a short form ("Nic" for "Nicolas"), 1 = a typo away, 0 = different.
  function wordMatch(typed, word) {
    if (typed === word) return 4;
    if (word.startsWith(typed)) return 3;
    if (word.length >= 3 && typed.startsWith(word)) return 2;
    const limit = typoLimit(typed.length);
    if (!limit) return 0;
    if (withinEdits(typed, word, limit)) return 1;
    // A typo in a name that is still being typed: "antetokoum" is close to the start of "antetokounmpo".
    for (let length = typed.length - 1; length <= typed.length + 1; length += 1) {
      if (length > 0 && length < word.length && withinEdits(typed, word.slice(0, length), limit)) return 1;
    }
    return 0;
  }

  // Pairs every typed word with a different name word, preferring the best total and then the name's word order.
  function bestAssignment(qualities, wordCount) {
    if (qualities.some(row => !row.some(Boolean))) return null;
    if (qualities.length === 1) return { total: Math.max(...qualities[0]), ordered: true };
    const used = new Array(wordCount).fill(false);
    const chosen = [];
    let best = null;
    (function search(index, total) {
      if (index === qualities.length) {
        const ordered = chosen.every((word, position) => !position || word > chosen[position - 1]);
        const rank = total * 2 + (ordered ? 1 : 0);
        if (!best || rank > best.rank) best = { rank, total, ordered };
        return;
      }
      for (let word = 0; word < wordCount; word += 1) {
        if (used[word] || !qualities[index][word]) continue;
        used[word] = true;
        chosen.push(word);
        search(index + 1, total + qualities[index][word]);
        chosen.pop();
        used[word] = false;
      }
    })(0, 0);
    return best;
  }

  // Some typed words match and at least one clearly does ("lebron curry" still finds LeBron James).
  // Longer matching words count for more, so "jay brunson" puts Jalen Brunson ahead of Jay Huff.
  function partialScore(typedWords, qualities) {
    let total = 0;
    let length = 0;
    let clear = false;
    typedWords.forEach((typed, index) => {
      const quality = Math.max(...qualities[index]);
      total += quality * typed.length;
      length += typed.length;
      if (quality >= 2 && typed.length >= 3) clear = true;
    });
    return clear ? 10 + Math.round(15 * total / (4 * length)) : 0;
  }

  // Scores names against one query. Word comparisons are remembered because the same first and last
  // names appear on many rosters.
  function scorer(query) {
    const typed = typeof query === "string" ? prepare(query) : query;
    const remembered = typed.tokens.map(() => new Map());
    const match = (index, word) => {
      let quality = remembered[index].get(word);
      if (quality === undefined) remembered[index].set(word, quality = wordMatch(typed.tokens[index], word));
      return quality;
    };
    const limit = typoLimit(typed.compact.length);
    return name => {
      const candidate = typeof name === "string" ? prepare(name) : name;
      if (!typed.compact || !candidate.compact) return 0;
      if (typed.compact === candidate.compact) return 100;
      const qualities = typed.tokens.map((_, index) => candidate.tokens.map(word => match(index, word)));
      let best = 0;
      if (typed.tokens.length <= candidate.tokens.length) {
        const assignment = bestAssignment(qualities, candidate.tokens.length);
        if (assignment) best = 60 + Math.round(30 * assignment.total / (4 * typed.tokens.length)) + (assignment.ordered ? 5 : 0);
      }
      // Typed without spaces from the start of a word: "jalenbrun" runs into the next word, "gil geous" stays in one.
      const startWord = typed.compact.length >= 3 ? candidate.starts.findIndex(start => candidate.compact.startsWith(typed.compact, start)) : -1;
      if (startWord >= 0) {
        const end = startWord + 1 < candidate.starts.length ? candidate.starts[startWord + 1] : candidate.compact.length;
        best = Math.max(best, candidate.starts[startWord] + typed.compact.length > end ? 90 : 55);
      }
      if (best) return best;
      if (typed.tokens.length === 1 && typed.compact.length <= 4 && candidate.tokens.length > 1 &&
          typed.compact === candidate.initials) return 50;
      if (limit && typed.compact[0] === candidate.compact[0]) {
        if (withinEdits(typed.compact, candidate.compact, limit)) return 35;
        for (let length = typed.compact.length - 1; typed.tokens.length === 1 && length <= typed.compact.length + 1; length += 1) {
          if (length < candidate.compact.length && withinEdits(typed.compact, candidate.compact.slice(0, length), limit)) return fullMatch;
        }
      }
      return partialScore(typed.tokens, qualities);
    };
  }

  const score = (query, name) => scorer(query)(name);

  // Best matches first (ties alphabetical). Partial matches are only returned when nothing matches the whole query.
  // `total` is how many names matched before `limit` cut the list.
  function rank(entries, query, limit = 20) {
    const typed = prepare(String(query || "").slice(0, 60));
    if (!typed.compact) return { results: [], approximate: false, total: 0 };
    const scoreName = scorer(typed);
    const scored = [];
    for (const entry of entries) {
      const value = scoreName(entry.search || entry.name);
      if (value > 0) scored.push({ entry, value });
    }
    const full = scored.filter(item => item.value >= fullMatch);
    const pool = full.length ? full : scored;
    pool.sort((first, second) => second.value - first.value || String(first.entry.name).localeCompare(String(second.entry.name)));
    return { results: pool.slice(0, limit).map(item => item.entry), approximate: !full.length && pool.length > 0, total: pool.length };
  }

  const api = { fullMatch, normalize, prepare, score, rank };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.playerSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
