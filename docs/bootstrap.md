# Bootstrap Harness over SSH

Boot Claude Code (or any harness) on local or remote mesh nodes via SSH.

## Prerequisites

- SSH keys configured in `~/.ssh/config` for each mesh node
- SSH agent running (`ssh-agent` + `ssh-add`) for key forwarding to remotes
- `tmux` or `screen` installed on target host
- `claude` CLI installed on target host (for Claude Code harness)
- Git remote access from target host (SSH agent forwarding passes keys)

## Flow

```
  Dashboard (Settings > Bootstrap)
       |
       | POST /api/boot
       |   { host, projectPath, harness, multiplexer, yolo, prompt }
       v
  +-----------+
  | Boot API  |
  +-----+-----+
        |
        +-- localhost? ---------> local tmux/screen
        |                              |
        +-- remote host? -------> ssh -A host
                |                      |
                |  1. Preflight: which claude, which tmux
                |  2. Ensure repo: test -d path || git clone
                |  3. Create tmux session/window
                |  4. Send harness command via tmux send-keys
                v
        +----------------+
        | Remote tmux    |
        | session        |
        |  +----------+  |
        |  | claude   |  |  <-- harness running in multiplexer
        |  | --yolo   |  |
        |  | project/  |  |
        |  +----------+  |
        +----------------+
                |
                | git push (via SSH agent forwarding)
                v
           Git remote
```

## Mesh Node Discovery

Nodes are discovered from `~/.ssh/config`. Any `Host` entry matching `*.foxhop.net` or a bare hostname (no dots, not `localhost`) is treated as a mesh node.

```
# ~/.ssh/config
Host neoblanka
  HostName neoblanka.foxhop.net
  User fox
  IdentityFile ~/.ssh/id_ed25519

Host cammy
  HostName cammy.foxhop.net
  User fox
  IdentityFile ~/.ssh/id_ed25519
```

## SSH Agent Forwarding

The boot API uses `ssh -A` which forwards your local SSH agent to the remote. This means:

- The remote can `git clone`/`git push` using your local SSH keys
- No need to copy private keys to remote machines
- The agent forwarding is per-connection, not persistent

Ensure your agent has the right keys loaded:

```bash
# Check loaded keys
ssh-add -l

# Add a key
ssh-add ~/.ssh/id_ed25519
```

## OAuth Dance (Claude Code)

First-time Claude Code use on a new machine requires OAuth authentication:

1. Boot starts Claude in tmux on the remote
2. Claude outputs a URL for browser-based OAuth
3. Attach to the remote tmux session: `ssh host tmux attach -t project`
4. Open the URL in your browser, complete the OAuth flow
5. Claude activates and is ready for work
6. Subsequent boots on that machine skip OAuth (token is cached)

This is a one-time step per machine. After OAuth, the bootstrap panel can launch agents without intervention.

## Boot Sequence (Remote)

1. **Preflight** - Verify `claude` and `tmux` exist on remote via SSH
2. **Ensure repo** - Check if `projectPath` exists on remote. If not, read the git remote URL from the local copy and `git clone` it on the remote (agent forwarding passes SSH keys)
3. **Create session** - Create tmux session (per-project) or new window (if session exists)
4. **Set environment** - `UNFIREHOSE_TMUX_SESSION`, `UNFIREHOSE_TMUX_WINDOW`, `UNFIREHOSE_PARENT_SESSION`
5. **Launch harness** - `tmux send-keys` the claude command with flags (`--dangerously-skip-permissions`, `--append-system-prompt`, initial prompt)
6. **Register deployment** - Record in `agent_deployments` table for tracking

## Boot Sequence (Local)

Same as remote but without SSH. Detects tmux vs screen (or uses `preferMultiplexer` from request). Windows falls back to PowerShell in a new terminal window.

## Working Across the Mesh

Once bootstrapped, an agent can work on any project accessible from its host:

- Projects are identified by filesystem path (same path convention across machines)
- Git remotes are the coordination layer: agents push, other agents pull
- The unfirehose dashboard tracks all sessions across all mesh nodes
- Agents signal completion with `UNEOF` in their output, triggering the cull system

## API

```
POST /api/boot
{
  "projectPath": "/home/fox/git/myproject",
  "harness": "claude",              // or custom command string
  "preferMultiplexer": "tmux",      // "tmux" | "screen"
  "yolo": true,                     // --dangerously-skip-permissions
  "prompt": "fix the tests",        // optional initial prompt
  "host": "neoblanka"               // omit for localhost
}

Response:
{
  "success": true,
  "tmuxSession": "myproject",
  "tmuxWindow": "183042",
  "multiplexer": "tmux",
  "host": "neoblanka",
  "command": "ssh neoblanka tmux attach -t myproject"
}
```

## Settings

Configured in Settings > Compute / Boot:

- **Default Host** - Where "Start Now" boots agents (localhost or mesh node)
- **Boot Strategy** - `default` (always use configured host), `least-loaded` (pick lowest load), `round-robin` (rotate across nodes)
