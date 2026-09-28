# DESIGN.md conformance fixtures

The three examples `google-labs-code/design.md` ships, vendored verbatim from
`examples/<name>/DESIGN.md`. Upstream is Apache-2.0, the same license as this
repo; they are included under that license and are not velloo's work.

- Source: https://github.com/google-labs-code/design.md
- Examples last changed at commit `89012cc4d140530d60742f76be04768585c1aa3a`
- Vendored: 2026-09-20 (spec version `alpha`, CLI 0.4.0)

They are here because the format is explicitly unstable ("expect changes as it
matures") and because all three name their color roles after Material 3 rather
than velloo's own vocabulary — which is the case the importer's alias table
exists for. If upstream re-authors them, `import-design-md-conformance.test.ts`
is what notices.

Update them with the fetch script in that test's header comment, and expect the
coverage assertions to be what fails first.
