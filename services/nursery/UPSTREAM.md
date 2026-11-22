# llm-nursery vendor snapshot

- Upstream: https://github.com/tsuru0805/llm-nursery
- Commit: `c309af66a6a1af7f429405e852d780bc33262162`
- License: MIT; the unmodified upstream license is preserved at `vendor/LICENSE`.
- Local integration: `bridge.py` adds a private authenticated HTTP boundary, a five-minute tick loop, and a temporary read-only projection of Lumbre chat turns for the upstream archive sampler.
- The optional psyche/API layer is deliberately disabled in the bridge environment.
