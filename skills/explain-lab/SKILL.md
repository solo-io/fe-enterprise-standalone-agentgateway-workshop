---
name: explain-lab
description: Say what a lab has the user click and what it proves, before its spec runs. Use in enablement mode ahead of each lab.
---

# Explain a lab

Given a lab id such as `llm/virtual-api-keys` and its lab path from `e2e/run-e2e.sh --list`, for example `labs/llm/virtual-api-keys.md`:

1. Open the lab. Read "What you'll do" and "Why this matters". Skim the `## Step N` headings for the UI pages the lab uses.
2. Find the lab's row in `README.md` and read its **What you do** and **Needs** cells.
3. Say in three to five sentences what the user would click, on which UI pages, and what the lab proves. Use the user's own words for their goals if they gave any.
4. Cite the lab path once so they can read it themselves, and name the screenshot folder `images/<track>/<slug>/` so they can see each step.

Write the explanation by `skills/stop-slop/SKILL.md`. Do not paste YAML, commands, or lab steps unless the user asks. If the lab calls a provider or needs a helper profile or another key, say so in the last sentence.
