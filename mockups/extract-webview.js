#!/usr/bin/env node
/**
 * Extracts the real webview HTML, verbatim, from
 * src/webview/configViewProvider.ts's getHtmlContent() method, so the
 * marketplace/README screenshot can never silently drift from what actually
 * ships. Only the sample state dispatched at the bottom of this script is
 * mockup data (mirrors bedrock-claude-code's mockups/screenshot-sidebar.html
 * __SIDEBAR_DATA__ convention) — everything else (markup, CSS, client script)
 * is the untouched real source.
 */

const fs = require("fs");
const path = require("path");

const srcPath = path.join(__dirname, "..", "src", "webview", "configViewProvider.ts");
const src = fs.readFileSync(srcPath, "utf8");

const methodMarker = "getHtmlContent";
const methodIdx = src.indexOf(methodMarker);
if (methodIdx === -1) {
	throw new Error("Could not find getHtmlContent() in configViewProvider.ts — did the method get renamed?");
}

const startMarker = "return `";
const startIdx = src.indexOf(startMarker, methodIdx);
if (startIdx === -1) {
	throw new Error("Could not find the start of the HTML template literal in getHtmlContent().");
}
const templateStart = startIdx + startMarker.length;

const endMarker = "\n\t}\n}\n\nfunction getNonce";
const endMarkerIdx = src.indexOf(endMarker, templateStart);
if (endMarkerIdx === -1) {
	throw new Error("Could not find the end-of-file marker after the HTML template — did the file's tail change shape?");
}
const templateEnd = src.lastIndexOf("`;", endMarkerIdx);
if (templateEnd === -1 || templateEnd < templateStart) {
	throw new Error("Could not find the closing backtick of the HTML template.");
}

const NONCE = "mockupnonce00000000000000000000";
// The source has nested template literals (client-side backtick strings)
// inside the outer TS template literal, so `` \` `` and `\${` are escaped in
// the raw source text. TypeScript resolves those escapes to literal `` ` ``
// and `${` at compile time; a plain string slice does not, so do it here or
// the extracted script contains invalid, unescaped backslashes and throws a
// SyntaxError that silently kills the whole client script.
let html = src
	.slice(templateStart, templateEnd)
	.replace(/\\`/g, "`")
	.replace(/\\\$/g, "$")
	.replace(/\$\{nonce\}/g, NONCE);

// Stub acquireVsCodeApi() — only defined inside a real VS Code webview host.
// Without it, the real script's first line throws and the whole block
// (including the "message" listener our sample-state dispatch relies on)
// never runs. Inserted with the same nonce, immediately before the real
// script tag, so it isn't blocked by the extracted CSP meta tag.
const realScriptTag = `<script nonce="${NONCE}">`;
const realScriptIdx = html.indexOf(realScriptTag);
if (realScriptIdx === -1) {
	throw new Error("Could not find the real client <script> tag to stub acquireVsCodeApi before.");
}
const stubScript = `<script nonce="${NONCE}">
  function acquireVsCodeApi() {
    return { postMessage: function () {}, setState: function () {}, getState: function () { return null; } };
  }
</script>\n`;
html = html.slice(0, realScriptIdx) + stubScript + html.slice(realScriptIdx);

// Sample state for the screenshot, same shape as the real extension's
// "setState" postMessage payload (see updateWebviewState() in
// configViewProvider.ts). Only ever use "default" (or another obviously
// generic name) for awsProfile/profiles here — never a real profile name —
// since this ships as a public marketplace screenshot.
const sampleState = {
	showAllModels: true,
	logLevel: "info",
	requestTimeout: 120000,
	enableNative: true,
	awsProfile: "default",
	region: "eu-west-1",
	hideMantleModelsFromNative: false,
	enableMantle: true,
	mantleAuthMethod: "apiKey",
	mantleAwsProfile: "(default chain)",
	mantleRegion: "eu-west-1",
	mantleHasStoredKey: true,
	sendTools: true,
	emitPlaceholders: true,
	enablePromptCaching: true,
	assumeLongContextClaudeModels: true,
	modelMetadataSource: "none",
	modelMetadataUrl: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
	modelMetadataCacheHours: 24,
	profiles: ["default"],
	bedrockRegions: [
		{ label: "US East (N. Virginia)", value: "us-east-1" },
		{ label: "Europe (Ireland)", value: "eu-west-1" },
		{ label: "Europe (Frankfurt)", value: "eu-central-1" },
	],
	mantleRegions: [
		{ label: "US East (N. Virginia)", value: "us-east-1" },
		{ label: "Europe (Ireland)", value: "eu-west-1" },
		{ label: "Europe (Frankfurt)", value: "eu-central-1" },
	],
};

// Self-dispatch a synthetic "message" event carrying the sample state,
// reusing the real extension's own window.addEventListener('message', ...)
// handler already present in the extracted markup above — no rendering
// logic is duplicated here, only fixture data is supplied.
const dataScript = `
<script nonce="${NONCE}">
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'setState', state: ${JSON.stringify(sampleState)} } }));
</script>`;

html = html.replace("</body>", `${dataScript}\n</body>`);

const outPath = path.join(__dirname, "webview-content.gen.html");
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
