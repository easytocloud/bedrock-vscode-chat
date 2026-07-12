/**
 * AWS profile discovery via parseKnownFiles from @smithy/core
 */

import { parseKnownFiles } from "@smithy/core/config";

export async function listKnownAwsProfiles(): Promise<string[]> {
	try {
		const merged = await parseKnownFiles({});
		return Object.keys(merged).sort();
	} catch {
		return [];
	}
}
