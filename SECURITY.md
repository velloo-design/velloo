# Security Policy

We take the security of Velloo seriously. Velloo is local-first: the core tool
runs on your machine, is account-free, and sends nothing to a server unless you
explicitly opt into a cloud command (`velloo login`, `velloo publish`). Most of
the attack surface is therefore local.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Instead, use GitHub's [private vulnerability reporting](https://github.com/velloo-design/velloo/security/advisories/new)
on this repository ([how it works](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Include what you found, how to reproduce it, and the impact you expect. We will
acknowledge your report, keep you updated on the fix, and credit you (if you
want) once it ships.

## Supported versions

Velloo ships continuously from `main`; security fixes land there and in the
latest published release. Older versions are not separately patched.
