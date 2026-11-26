# Alvos de teste em blocos (incluído pelo Makefile do projeto)
CLAUDE_TEST_SH := bash .claude/bin/test.sh
.PHONY: test-file test-block test-changed test-all
test-file:    ; @$(CLAUDE_TEST_SH) file "$(F)"
test-block:   ; @$(CLAUDE_TEST_SH) block "$(B)"
test-changed: ; @$(CLAUDE_TEST_SH) changed
test-all:     ; @$(CLAUDE_TEST_SH) all
