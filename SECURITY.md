# Security

## Supported versions

Only the latest release of Stepline gets security fixes. A fix ships as a new release, and Claude Code offers the update because the release raises the plugin's version. `claude plugin list` shows which version you have.

## Report a vulnerability

Report it privately through GitHub. Open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to <https://github.com/saadk408/stepline/security/advisories/new>. Only you and the repository's maintainers can see the report.

Never report a vulnerability in a public issue, discussion, or pull request. If the **Report a vulnerability** button isn't there, open an issue that asks for a private way to reach the maintainer, and leave the details out.

## What to include

- What someone could do through the problem, and what it takes: a plan's text, a tool call, or a file that has to be in place.
- The shortest steps that reproduce it.
- Stepline's version, and Claude Code's (`claude --version`).
- Your OS, and whether you use the terminal or the Desktop app's Code tab.
- Any output from `claude --debug` that shows it, with secrets and private paths removed.

## What to expect

- The maintainer acknowledges the report on the advisory and asks for anything missing.
- Once the problem is confirmed, the fix ships in a new release, and that release's entry in [CHANGELOG.md](CHANGELOG.md) notes it.
- The advisory says when the release is out.

## Scope

Stepline is a mod. It runs inside Claude Code, with your permissions, in every session that loads it. It can:

- read the plan file Claude Code saved for an approval, when the approval doesn't carry the plan's text
- make one `haiku` call per approved plan, through your own Claude Code session
- read the titles and statuses in Claude's TodoWrite, TaskCreate, and TaskUpdate calls, without changing them
- be told when each turn starts. It ignores the prompt's text and can't change it.
- add the plan's checklist to Claude's context, on approval and when `/stepline` hands the plan back, and give Claude a one-line reply to each `/stepline` command and each `update_step` or `amend_plan` call
- allow its own tools, `mcp__stepline__update_step` and `mcp__stepline__amend_plan`, without a prompt. It doesn't answer the permission check for any other tool.
- save the plan in its own store under `~/.claude/plugins/store/`
- draw the band above the prompt, its pane, its toasts, and the transcript rows of its own tools

The README's [Data and permissions](README.md#data-and-permissions) section covers each of these, and `claude plugin validate .` prints every hook the mod registers and every call it makes. [PRIVACY.md](PRIVACY.md) says what it stores and for how long.

**In scope:** anything that makes Stepline go beyond that list. For example, a plan or a tool call that gets it to read another file, to allow a tool other than its own, or to put text in Claude's context beyond what the README describes.

**Out of scope:**

- Problems in Claude Code itself, in the model, or in another plugin. Report a problem in Claude Code to Anthropic, as its [security policy](https://github.com/anthropics/claude-code/security/policy) describes.
- Problems that need someone who can already write to your `~/.claude` directory or run code as you.
