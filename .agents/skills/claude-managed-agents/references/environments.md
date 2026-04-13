# Cloud Environments & Runtimes

Environments are reusable container templates where agents execute tasks. Each session gets its own isolated instance.

## Container Specifications

- **OS**: Ubuntu 22.04 LTS (x86_64).
- **Resources**: Up to 8 GB RAM, 10 GB Disk.
- **Default Network**: Disabled (must enable in config).

## Configuration Options

### 1. Packages
Pre-install software via `apt`, `cargo`, `gem`, `go`, `npm`, or `pip`.
```json
"packages": {
  "pip": ["pandas", "scikit-learn"],
  "npm": ["express"]
}
```

### 2. Networking
- **Unrestricted**: Full outbound access (default).
- **Limited**: Restricts to `allowed_hosts` (HTTPS).
- **Isolated**: No network access.

## Pre-installed Runtimes

- **Languages**: Python 3.12+, Node.js 20+, Go 1.22+, Rust 1.77+, Java 21+, Ruby 3.3+, PHP 8.3+.
- **Databases**: SQLite (local), Client tools for PostgreSQL and Redis.
- **Utilities**: `git`, `curl`, `jq`, `tar`, `ssh`, `ripgrep`, `vim`, `diff`.

## Environment Lifecycle

- Environments persist until archived or deleted.
- Deletion is only permitted if no active sessions reference the environment.
- Multiple sessions share the template but never share the file system state.
