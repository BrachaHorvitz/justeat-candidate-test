---
name: department-headcount
description: Reports how many employees are currently in each department. Use whenever anyone asks for employee counts per department or a headcount by department, in any wording or language, including "How many employees are currently in each department?" and "כמה עובדים יש כרגע בכל מחלקה?".
allowed-tools: Bash(node scripts/department-report.js), PowerShell(node scripts/department-report.js)
---

# Department headcount

1. Run this exact command from the project root, even if you already answered this question earlier in the conversation:

   ```
   node scripts/department-report.js
   ```

2. Reply with the command's output exactly as printed, inside a plain code block, and nothing else.

Rules:

- Never count, estimate, reformat, sort, or translate the numbers yourself.
- Never query the database directly or edit any code to answer this question.
- If the command fails, say that the report could not be produced and show the error. Do not give any numbers.
