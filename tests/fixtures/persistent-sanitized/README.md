# Sanitized persistent fixture

This directory contains synthetic, privacy-safe data with the same top-level
shapes used by Lumbre. It is deliberately not copied from production.

Tests copy or recreate fixtures inside a unique temporary `DATA_DIR`. Never set
test `DATA_DIR` to `/persistent`.
