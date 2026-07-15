/**
 * Shared text-sanitization, choice-validation, and cloning utilities.
 * Used by both server.js and scenarioStore.js to avoid duplication.
 */

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeChoice(value, allowed, fallback) {
  const text = sanitizeText(value, 80);
  return allowed.includes(text) ? text : fallback;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

module.exports = { sanitizeText, sanitizeChoice, cloneJson };
