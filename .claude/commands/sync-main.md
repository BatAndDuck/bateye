# Sync Current Branch with Newest Main

Fetch and merge the latest `origin/main` into the **current working branch**, handling worktrees correctly.

## Steps

1. Determine the current working directory:
   - If inside a worktree (path contains `.claude/worktrees/`), operate there
   - Otherwise operate in the main repo root

2. Run:
   ```
   git fetch origin main
   git merge origin/main --no-edit
   ```

3. If there are merge conflicts:
   - Show the conflicting files
   - Resolve each conflict by preferring `origin/main` changes unless the conflict is in a file we intentionally modified (check both sides carefully)
   - Stage resolved files and complete the merge with `git merge --continue`

4. Before pushing, update `.ai-sessions-log` in the repo root:
   - Find the existing entry for this session/branch (same date + topic line)
   - If it exists, append ` +YYYY-MM-DD <brief note about what this push adds>`
   - If no entry exists yet, add a new line: `YYYY-MM-DD | branch-or-topic | what changed + why (max 300 chars)`
   - Stage the file: `git add .ai-sessions-log`

5. After updating the log, push:
   ```
   git push
   ```

6. Confirm the final HEAD commit hash and list what changed files came in from main.

> **Note:** Always operate in the correct directory. The worktree at `.claude/worktrees/<name>` and the main repo at the project root are separate - make sure to run git commands in the right one (wherever the current branch is checked out).
