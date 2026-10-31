// Reports script errors on WiselyBet pages to the server log so problems can be fixed quickly.
// Only the error itself and the page address are sent: no account details, picks or settings.
(function () {
  var sent = 0;
  var noise = /^(Script error\.?|ResizeObserver loop|AbortError|The (operation|user) (was|has) (aborted|cancel))|Failed to fetch|NetworkError|Load failed|network connection was lost/i;

  function report(kind, message, source, line, column, stack) {
    message = String(message || "").slice(0, 300);
    if (!message || noise.test(message) || sent >= 5) return;
    // Scripts from browser extensions or other sites are not ours to fix.
    if (source && String(source).indexOf(location.origin) !== 0) return;
    sent += 1;
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({
          kind: kind,
          message: message,
          source: source ? String(source).slice(0, 300) : "",
          line: Number(line) || 0,
          column: Number(column) || 0,
          stack: stack ? String(stack).slice(0, 1500) : "",
          page: location.pathname
        })
      }).catch(function () { /* reporting must never cause more errors */ });
    } catch (error) { /* ignore */ }
  }

  window.addEventListener("error", function (event) {
    // Failed image or audio loads have no message and are not script errors.
    if (!event || !event.message) return;
    report("error", event.message, event.filename, event.lineno, event.colno, event.error && event.error.stack);
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    if (reason && reason.name === "AbortError") return;
    report("rejection", reason && reason.message ? reason.message : String(reason), "", 0, 0, reason && reason.stack);
  });
})();
