export const RELEASES_API = "https://api.github.com/repos/openai/tunnel-client/releases/latest";
export const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest: string | null;
}

export interface GithubRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface SelectedRelease {
  version: string;
  name: string;
  url: string;
  size: number;
  sha256: string;
}

/** Choose only OpenAI's full Windows client, never unrelated release artifacts. */
export function selectWindowsRelease(release: GithubRelease, arch: "amd64" | "arm64"): SelectedRelease {
  const tag = release.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !Array.isArray(release.assets)) {
    throw new Error("Unexpected OpenAI release metadata.");
  }

  const name = "tunnel-client-" + tag + "-windows-" + arch + ".zip";
  const asset = release.assets.find((item) => item.name === name);
  if (!asset) throw new Error("The official Windows archive was not found.");

  const expectedUrl = "https://github.com/openai/tunnel-client/releases/download/" + tag + "/" + name;
  const digest = DIGEST_PATTERN.exec(asset.digest ?? "");
  if (
    asset.browser_download_url !== expectedUrl ||
    !digest ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1024 * 1024 ||
    asset.size > MAX_ARCHIVE_BYTES
  ) {
    throw new Error("Release verification metadata is missing or invalid.");
  }

  return {
    version: tag,
    name,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: digest[1],
  };
}
