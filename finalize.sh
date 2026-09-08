#!/usr/bin/env bash
set -e
cd /home/lenovo/ghl-portal
source ~/.nvm/nvm.sh
nvm use 22 >/dev/null 2>&1

rm -f verify2.sh integrate.sh build.sh runshot.sh verify.sh finish.sh
git add -A
git status -s | tr -d '\r'

git commit -q -m "Match Chris's Portfolio Dashboard mockup; dark Project Hub shell

Rebuild the contractor landing screen to the AI-Studio mockup: four company
metric tiles (active projects, at-risk/delayed, open change orders, revenue
under contract), an active-projects overview with health and progress, a
Needs Attention panel, and a recent-activity feed — all on real tenant data,
money tiles honest where BuildSuite holds a band not an amount.

Reskin the shared shell sidebar dark navy with the amber brand mark to match
the mockup; reads cohesively on contractor, field and client alike.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
echo "committed: $(git log --oneline -1 | tr -d '\r')"

echo "=== typecheck ==="
( cd apps/web && npx tsc --noEmit ) && echo "TSC_OK" || { echo "TSC_FAIL"; exit 4; }

echo "=== build ==="
( cd apps/web && rm -rf .next && npx next build > /tmp/nextbuild3.log 2>&1 ) && echo "BUILD_OK" || { echo "BUILD_FAIL"; tail -n 40 /tmp/nextbuild3.log; exit 5; }

echo "=== ff check vs company/main ==="
git fetch company main 2>&1 | tail -1 | tr -d '\r'
git rev-list --left-right --count company/main...HEAD | tr -d '\r'

echo "=== push to company/main ==="
GIT_TERMINAL_PROMPT=0 git push company HEAD:main 2>&1 | sed -E "s#x-access-token:[^@]*@#x-access-token:***@#" | tr -d '\r'
echo "PUSHED"
