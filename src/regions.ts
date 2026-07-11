/**
 * Single source of truth for the AWS regions this extension exposes in its UI
 * (region quick-picks in extension.ts). Keep the `aws-bedrock.region` /
 * `aws-bedrock.mantleRegion` enums and enumDescriptions in package.json in sync
 * with these lists when they change — package.json can't import this module at
 * packaging time.
 *
 * Native Bedrock (bedrock-runtime) and Mantle (bedrock-mantle) are deployed to
 * different, non-overlapping-by-superset region sets — Mantle is available in a
 * strict subset. Cross-checked against AWS's own region-availability-by-endpoint
 * docs on 2026-07-11: https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints-region-availability.html
 */

export interface AwsRegionOption {
	value: string;
	label: string;
}

/** Regions where the native Bedrock (Converse/Invoke) backend is available. */
export const AWS_BEDROCK_REGIONS: AwsRegionOption[] = [
	{ value: "us-east-1", label: "US East (N. Virginia)" },
	{ value: "us-east-2", label: "US East (Ohio)" },
	{ value: "us-west-1", label: "US West (N. California)" },
	{ value: "us-west-2", label: "US West (Oregon)" },
	{ value: "ca-central-1", label: "Canada (Central)" },
	{ value: "eu-west-1", label: "Europe (Ireland)" },
	{ value: "eu-west-2", label: "Europe (London)" },
	{ value: "eu-west-3", label: "Europe (Paris)" },
	{ value: "eu-central-1", label: "Europe (Frankfurt)" },
	{ value: "eu-north-1", label: "Europe (Stockholm)" },
	{ value: "eu-south-1", label: "Europe (Milan)" },
	{ value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
	{ value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
	{ value: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
	{ value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
	{ value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
	{ value: "ap-southeast-3", label: "Asia Pacific (Jakarta)" },
	{ value: "sa-east-1", label: "South America (São Paulo)" },
];

/**
 * Regions where the bedrock-mantle endpoint is available — a strict subset of
 * AWS_BEDROCK_REGIONS. Notably missing (native-only, no Mantle): us-west-1,
 * ca-central-1, eu-west-3, ap-northeast-2, ap-southeast-1. GovCloud
 * (us-gov-west-1) also has Mantle but is intentionally omitted here, matching
 * this extension's existing GovCloud-free region list.
 */
const MANTLE_REGION_VALUES = new Set([
	"us-east-1",
	"us-east-2",
	"us-west-2",
	"eu-west-1",
	"eu-west-2",
	"eu-central-1",
	"eu-north-1",
	"eu-south-1",
	"ap-south-1",
	"ap-northeast-1",
	"ap-southeast-2",
	"ap-southeast-3",
	"sa-east-1",
]);

export const AWS_MANTLE_REGIONS: AwsRegionOption[] = AWS_BEDROCK_REGIONS.filter((r) =>
	MANTLE_REGION_VALUES.has(r.value)
);

export const DEFAULT_AWS_REGION = "us-east-1";
