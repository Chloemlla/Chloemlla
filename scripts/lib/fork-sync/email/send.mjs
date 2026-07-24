/**
 * Happy-TTS outemail API client for fork-sync reports.
 * Soft-rich error messages; requires JSON success === true.
 */

import { redact, logError } from "../util.mjs";

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.content HTML body
 * @returns {Promise<object>} parsed JSON response
 */
export async function sendEmail({ baseUrl, apiKey, to, subject, content }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/outemail/send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      subject,
      content,
      from: "noreply",
      displayName: "Fork Sync Bot",
    }),
  });
  const text = await res.text();
  const bodySnippet = text.length > 1500 ? `${text.slice(0, 1500)}…` : text;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const msg = redact(
      `Outemail failed HTTP ${res.status}: non-JSON response | body=${bodySnippet}`,
    );
    logError(msg);
    throw new Error(msg);
  }

  // Accept only JSON objects with success === true and HTTP OK.
  // Avoids throwing on parsed null/primitive before building a rich message.
  if (
    !res.ok ||
    parsed == null ||
    typeof parsed !== "object" ||
    parsed.success !== true
  ) {
    // Example: Outemail failed HTTP 401: unauthorized | success=false | body={...}
    let errLabel = "request failed";
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.error != null &&
      parsed.error !== ""
    ) {
      errLabel =
        typeof parsed.error === "string"
          ? parsed.error
          : JSON.stringify(parsed.error);
    }
    const successPart =
      parsed && typeof parsed === "object" && "success" in parsed
        ? ` | success=${JSON.stringify(parsed.success)}`
        : "";
    const rich = redact(
      `Outemail failed HTTP ${res.status}: ${errLabel}${successPart} | body=${bodySnippet}`,
    );
    logError(rich);
    throw new Error(rich);
  }
  return parsed;
}
