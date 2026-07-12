/**
 * AWS profile discovery via parseKnownFiles from @smithy/core
 */

import { parseKnownFiles } from "@smithy/core/config";

export async function listKnownAwsProfiles(onError?: (error: unknown) => void): Promise<string[]> {
	try {
		const merged = await parseKnownFiles({});
		return Object.keys(merged).sort();
	} catch (error) {
		// Common real-world cause: ~/.aws (or ~/.aws/config) is a symlink into a
		// location the process isn't permitted to read (e.g. iCloud Drive's
		// "Mobile Documents" container without the OS-level Files and Folders
		// permission granted) — silently returning [] here just looks like a
		// broken dropdown with no clue why, so let the caller log it instead.
		onError?.(error);
		return [];
	}
}
