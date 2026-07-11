/**
 * Single source of truth for the AWS regions this extension exposes in its UI
 * (region quick-pick in extension.ts). Keep the `aws-bedrock.region` enum and
 * enumDescriptions in package.json in sync with this list when it changes —
 * package.json can't import this module at packaging time.
 */

export interface AwsRegionOption {
	value: string;
	label: string;
}

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

export const DEFAULT_AWS_REGION = "us-east-1";
