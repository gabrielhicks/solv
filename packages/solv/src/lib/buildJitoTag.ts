/**
 * Build a jito-solana git tag for a given version.
 *
 * - If the version already contains a `-jito` suffix (e.g. `4.4.1-jito.0`),
 *   it is treated as an exact tag and used as-is.
 * - The patch suffix (e.g. `.0`) is only appended when the version is one of
 *   the pinned default versions it was configured for. Custom versions passed
 *   via `-v` get the plain `v<version>-jito` tag, unless the user includes the
 *   patch explicitly.
 */
export const buildJitoTag = (
  version: string,
  patch: string,
  pinnedVersions: string[] = [],
) => {
  const normalized = version.trim().replace(/^v/, '')
  if (normalized.includes('-jito')) {
    return `v${normalized}`
  }
  const applyPatch = patch !== '' && pinnedVersions.includes(normalized)
  return `v${normalized}-jito${applyPatch ? patch : ''}`
}
