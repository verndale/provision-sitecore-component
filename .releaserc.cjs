/**
 * semantic-release configuration
 *
 * - Version bumping driven by Conventional Commits
 * - Release notes: deterministic and structured via local plugin
 *   (scripts/release/semantic-release-structured-notes.cjs). Optional AI summary
 *   when RELEASE_NOTES_AI=true and endpoint/API key are set (opt-in).
 * - `fix` type maps to patch release
 * - Generates/updates CHANGELOG.md
 * - Writes version to package.json (without publishing to npm)
 * - Creates Git tags + GitHub Releases
 */
module.exports = {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { type: 'feat', release: 'minor' },
          { type: 'fix', release: 'patch' },
          { breaking: true, release: 'major' },
          { revert: true, release: 'patch' },
        ],
        parserOpts: {
          noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
        },
      },
    ],

    './scripts/release/semantic-release-structured-notes.cjs',

    [
      '@semantic-release/npm',
      {
        npmPublish: false,
      },
    ],

    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
      },
    ],

    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'pnpm-lock.yaml'],
        message: 'chore(release): ${nextRelease.version}\n\n${nextRelease.notes}',
      },
    ],

    [
      '@semantic-release/github',
      {
        // Uses the built-in GITHUB_TOKEN in Actions
      },
    ],
  ],
};
