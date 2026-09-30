# Security policy

## Reporting a vulnerability

Report it privately through **Security → Report a vulnerability** on
this repository. Do not open an issue or a pull request: issues here
are read by the project's agents and fixed in public.

You get an answer within seven days. There is no bug bounty.

## Supported versions

The latest stable release. Nightly pre-releases are not supported.

## Scope

In scope: anything that exposes vault plaintext or key material to the
server or to another account, bypasses sign-in, a session or the
administrator boundary, or runs script in the app despite its content
security policy. The same goes for the build and release pipeline.

Out of scope: the risks `spec/architecture.md` accepts under Threat
model, such as metadata the server can see and the absence of password
recovery, and the configuration of an individual self-hosted instance.

## Disclosure

A confirmed vulnerability is fixed in the advisory's private fork,
released, and then published as a GitHub security advisory crediting
the reporter.
