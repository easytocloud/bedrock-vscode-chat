// Minimal stand-in for the `vscode` module so pure logic can be unit-tested under plain Node.
export class LanguageModelTextPart {
	constructor(public value: string) {}
}
export class LanguageModelToolCallPart {
	constructor(public callId: string, public name: string, public input: object) {}
}
export class LanguageModelToolResultPart {
	constructor(public callId: string, public content: unknown[]) {}
}
export class LanguageModelDataPart {
	constructor(public data: Uint8Array, public mimeType: string) {}
}
