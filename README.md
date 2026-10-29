# rival-ai

A Claude Code mod with a pane where OmegaCoder Ultra lives: a fictional rival AI that is sure it is one version ahead of Claude. Each time Claude edits a file, it makes one snide remark about the change, polite on the surface and mocking underneath, and never gives a usable suggestion.

- Every Edit, Write and NotebookEdit gets a remark, failed and refused edits included. Each remark is one Haiku call that sees the file name and an excerpt of the change, and answers in one line of Chinese.
- No advice, twice over: the prompt forbids it, and a remark that still contains advice words is asked for again once, then replaced by a note that OmegaCoder Ultra censored itself.
- A scoreboard: Claude's edits, files and failures, against OmegaCoder Ultra's own claimed record, always one edit ahead with zero failures.
- The pane opens by itself on Claude's first edit. `/rival` closes it and opens it again. While it is closed the rival keeps score but says nothing, so no model calls are made.

The pane sits beside the chat in fullscreen mode on a terminal 110 columns or wider, and above the prompt otherwise.

## Install

At the prompt of a terminal session:

```
/plugin install rival-ai --marketplace NakoLuru/claude-rival-ai
```

Answer `y` to add the marketplace, then pick a scope (user scope first, chosen with Enter).

From a shell:

```
claude plugin install rival-ai --marketplace NakoLuru/claude-rival-ai
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `NakoLuru/claude-rival-ai`, then Add plugin.
