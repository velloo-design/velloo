# Security Policy

We take the security of Velloo seriously. Velloo is local-first: the core tool
runs on your machine, is account-free, and sends nothing to a server unless you
explicitly opt into a cloud command (`velloo login`, `velloo publish`). Most of
the attack surface is therefore local.

## Local agents

The canvas's Agent tab starts your own Codex or Claude Code as a child of the
local daemon. The browser can name a provider, a prompt, an approval
decision and one of the agent's own permission modes — never a working
directory, executable, environment or sandbox, nor a mode that turns approvals
off — and the daemon's API answers only loopback, same-origin requests. Velloo
never answers an approval on its own, never moves a session into a mode that
skips every check, and never enables a provider's remote listener. See
[docs/agent-tab.md](docs/agent-tab.md).

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
